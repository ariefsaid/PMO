// @e2e-isolation: serial — restores transfer mode; posted stock records remain isolated to this run's new items and locations.
import { test, expect } from '@playwright/test';
import { serviceClient, need, ORG_ID } from '../support/jobJourney';
const db=serviceClient('AC-SITE-009'); const must=need('AC-SITE-009');
test('AC-SITE-009 the field receiver counts nine of ten and records the required quality result', async ({page}) => {
 await page.setViewportSize({width:390,height:844});
 const run=crypto.randomUUID(); const password=`${run}-Aa1!`; const users:string[]=[];
 const setting=must('setting',await db.from('organizations').select('stock_transfer_mode').eq('id',ORG_ID).single());
 try {
  for(const [suffix,role,key] of [['sender','Admin',null],['receiver','Engineer','field_user']] as const) {
   const email=`${suffix}-${run}@example.invalid`; const created = await db.auth.admin.createUser({email,password,email_confirm:true}); if(created.error || !created.data.user) throw new Error(created.error?.message ?? 'User not created'); const user = created.data.user; users.push(user.id);
   must('profile',await db.from('profiles').insert({id:user.id,org_id:ORG_ID,email,full_name:suffix,role,built_in_role:key}).select('id').single());
  }
  const sender=serviceClient('AC-SITE-009 setup');
  const signed = await sender.auth.signInWithPassword({email:`sender-${run}@example.invalid`,password}); if(signed.error) throw signed.error;
  must('transfer mode',await sender.rpc('set_stock_transfer_mode',{p_mode:'two_step'}));
  const unit=must('unit',await db.from('stock_units').insert({org_id:ORG_ID,code:run.slice(0,8),name:'Piece',whole_only:true}).select('id').single()).id;
  const item=must('item',await db.from('stock_items').insert({org_id:ORG_ID,code:run.slice(0,8),name:`Goods ${run}`,unit_id:unit,needs_quality_check:true}).select('id').single()).id;
  const wh:string[]=[]; for(const name of ['Origin','Destination']) wh.push(must('location',await db.from('stock_warehouses').insert({org_id:ORG_ID,code:`${name}-${run.slice(0,8)}`,name:`${name} ${run}`,kind:'central'}).select('id').single()).id);
  must('opening stock',await sender.rpc('create_stock_document',{p_header:{kind:'receive',warehouse_id:wh[0]},p_lines:[{item_id:item,quantity:10,unit_cost:0}],p_post:true}));
  const transfer=must('send',await sender.rpc('send_stock_transfer',{p_header:{warehouse_id:wh[0],to_warehouse_id:wh[1],to_user_id:users[1]},p_lines:[{item_id:item,quantity:10}],p_client_request_id:crypto.randomUUID()}));
  await page.goto('/login'); await page.getByLabel(/email/i).fill(`receiver-${run}@example.invalid`); await page.getByLabel(/password/i).fill(password); await page.getByRole('button',{name:/sign in/i}).click(); await expect(page).toHaveURL(/\/my$/);
  await page.getByRole('region', { name: 'A delivery for you' }).getByRole('link',{name:/Count and confirm/}).click(); await expect(page).toHaveURL(new RegExp(`/stock/transfers/${transfer}$`)); await expect(page.getByText(`Goods ${run}`,{exact:false})).toBeVisible();
  await page.getByLabel('Counted',{exact:true}).fill('9'); await page.getByLabel('Accepted',{exact:true}).fill('9');
  await page.getByRole('combobox',{name:/quality/i}).selectOption('pass'); await page.getByRole('button',{name:'Confirm receipt',exact:true}).click();
  await expect(page.getByRole('button',{name:'Confirm receipt',exact:true})).toHaveCount(0);
  await page.reload(); await expect(page.getByText(/1 short/)).toBeVisible();
  const line=must('count saved',await db.from('stock_transfer_lines').select('qty_counted,qty_accepted,quality_result').eq('transfer_id',transfer).single());
  expect(Number(line.qty_counted)).toBe(9); expect(Number(line.qty_accepted)).toBe(9); expect(line.quality_result).toBe('pass');
 } finally {
  await db.from('organizations').update({stock_transfer_mode:setting.stock_transfer_mode}).eq('id',ORG_ID);
  if(users.length) await db.from('profiles').update({status:'inactive'}).in('id',users);
 }
});
