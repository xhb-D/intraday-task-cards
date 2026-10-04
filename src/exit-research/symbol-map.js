// Research family and execution contract remain distinct identities.
export const EXECUTION_PRODUCTS = Object.freeze({ GC: 'MGC', ES: 'MES', CL: 'MCL' });
export const researchFamilyForProduct = product => Object.keys(EXECUTION_PRODUCTS).find(family => EXECUTION_PRODUCTS[family] === product) ?? null;
export const executionProductForFamily = family => EXECUTION_PRODUCTS[family] ?? null;
