begin;
select plan(2);
insert into organizations(id,name) values ('03491000-0000-0000-0000-000000000001','File Path Org');
insert into procurements(id,org_id,title,status) values
 ('03491000-0000-0000-0000-000000000010','03491000-0000-0000-0000-000000000001','Path owner A','Draft'),
 ('03491000-0000-0000-0000-000000000011','03491000-0000-0000-0000-000000000001','Path owner B','Draft');
insert into companies(id,org_id,name,type) values ('03491000-0000-0000-0000-000000000020','03491000-0000-0000-0000-000000000001','Path Vendor','Vendor');
insert into procurement_quotations(id,org_id,procurement_id,vendor_id,total_amount) values
 ('03491000-0000-0000-0000-000000000030','03491000-0000-0000-0000-000000000001','03491000-0000-0000-0000-000000000010','03491000-0000-0000-0000-000000000020',1);
select throws_ok($$insert into procurement_quotation_files(id,org_id,quotation_id,file_path) values
 ('03491000-0000-0000-0000-000000000040','03491000-0000-0000-0000-000000000001','03491000-0000-0000-0000-000000000030','03491000-0000-0000-0000-000000000001/03491000-0000-0000-0000-000000000011/quotation/03491000-0000-0000-0000-000000000040/file.pdf')$$,
 '23514','Procurement file storage key does not match its record.','AC-SEC-207: procurement file cannot point at a different procurement path');
select lives_ok($$insert into procurement_quotation_files(id,org_id,quotation_id,file_path) values
 ('03491000-0000-0000-0000-000000000041','03491000-0000-0000-0000-000000000001','03491000-0000-0000-0000-000000000030','03491000-0000-0000-0000-000000000001/03491000-0000-0000-0000-000000000010/quotation/03491000-0000-0000-0000-000000000041/file.pdf')$$,
 'AC-SEC-207: canonical org/procurement/phase path remains accepted');
select finish();
rollback;
