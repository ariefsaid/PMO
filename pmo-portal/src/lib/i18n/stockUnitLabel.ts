type Translate = (key: string, fallback: string) => string;
interface UnitLike { code: string; name: string }

/**
 * The five units the stock master ships with are stored in English. A reader in another language sees
 * them through the catalogue; a unit the organisation renamed or added shows exactly as typed.
 * Static calls keep every label visible to the i18n catalogue gates.
 */
export function stockUnitName(unit: UnitLike, t: Translate): string {
  switch (`${unit.code}|${unit.name}`) {
    case 'bag|Bag': return t('unitNames.bag', 'Bag');
    case 'm|Metre': return t('unitNames.m', 'Metre');
    case 'pcs|Piece': return t('unitNames.pcs', 'Piece');
    case 'L|Litre': return t('unitNames.L', 'Litre');
    default: return unit.name;
  }
}

/** The short code printed beside a quantity ("12 sak"). Quantity rows carry only the code, so the code alone decides. */
export function stockUnitCode(code: string, t: Translate): string {
  switch (code) {
    case 'bag': return t('unitCodes.bag', 'bag');
    case 'pcs': return t('unitCodes.pcs', 'pcs');
    default: return code;
  }
}
