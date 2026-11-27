import { getPriceVisibility, maskSelection, MASKABLE_FUNCTIONS, MASKABLE_TABLES, waitForPriceVisibility } from './priceReadPath';

const tables = [...MASKABLE_TABLES, ...MASKABLE_FUNCTIONS, 'procurement_open_commitment'].join('|');
const bearing = new RegExp(`\\b(${tables})(?:_masked)?\\b`);
const masked = new RegExp(`\\b(${tables})_masked\\b`, 'g');

/** Price-bearing REST reads wait for the organisation answer, including reads started before shell effects.
 *  Only reads that opted into masking are rewritten: the request path names a maskable table or rpc
 *  (priceSource/priceFn), or the select already carries a `_masked` embed (maskSelection/priceEmbed).
 *  Other reads that merely embed a maskable table are price-free by construction and are dispatched
 *  exactly as constructed — their selections may name columns a masked view does not expose. */
export function createPriceVisibilityFetch(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const rpc = url.pathname.includes('/rest/v1/rpc/');
    const selection = url.searchParams.get('select') ?? '';
    if (!url.pathname.includes('/rest/v1/') || (!rpc && method !== 'GET' && method !== 'HEAD') || !bearing.test(`${url.pathname} ${selection}`)) return base(input, init);
    const opted = /_masked/.test(selection) || new RegExp(`(?:rpc/)?(${tables})(_masked)?$`).test(url.pathname);
    await waitForPriceVisibility(init?.signal ?? (input instanceof Request ? input.signal : undefined));
    url.pathname = url.pathname.replace(masked, '$1');
    if (getPriceVisibility() !== false) url.pathname = url.pathname.replace(new RegExp(`(${tables})$`), '$1_masked');
    if (selection && opted) url.searchParams.set('select', maskSelection(selection.replace(masked, '$1')));
    return base(input instanceof Request ? new Request(url, input) : url, init);
  };
}
