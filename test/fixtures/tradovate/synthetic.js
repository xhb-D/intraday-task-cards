// Entirely synthetic data. Only public field names mirror the local export headers.
export const FILL_HEADERS = ["_id", "_orderId", "_contractId", "_timestamp", "_tradeDate", "_action", "_qty", "_price", "_active", "_accountId", "Fill ID", "Order ID", "Timestamp", "Date", "Account", "B/S", "Quantity", "Price", "_priceFormat", "_priceFormatType", "_tickSize", "Contract", "Product", "Product Description", "commission"];
export const ORDER_HEADERS = ["orderId", "Account", "Order ID", "B/S", "Contract", "Product", "Product Description", "avgPrice", "filledQty", "Fill Time", "lastCommandId", "Status", "_priceFormat", "_priceFormatType", "_tickSize", "spreadDefinitionId", "Version ID", "Timestamp", "Date", "Quantity", "Text", "Type", "Limit Price", "Stop Price", "decimalLimit", "decimalStop", "Filled Qty", "Avg Fill Price", "decimalFillAvg", "Venue", "Notional Value", "Currency"];
export const POSITION_HEADERS = ["Position ID", "Timestamp", "Trade Date", "Net Pos", "Net Price", "Bought", "Avg. Buy", "Sold", "Avg. Sell", "Account", "Contract", "Product", "Product Description", "_priceFormat", "_priceFormatType", "_tickSize", "Pair ID", "Buy Fill ID", "Sell Fill ID", "Paired Qty", "Buy Price", "Sell Price", "P/L", "Currency", "Bought Timestamp", "Sold Timestamp"];
export function fillRow({ fillId = '900000000000001', orderId = '900000000001001', account = 'SYNTH-A', accountId = '90000991',
  contract = 'MESZ9', product = 'MES', side = 'Buy', quantity = '2', price = '103.25',
  time = '2035-02-03 01:02:03.100Z', displayTime = '02/03/2035 09:02:03', ...extra } = {}) {
  return { _id: fillId, _orderId: orderId, _contractId: '90000881', _timestamp: time, _tradeDate: '2035-02-03',
    _action: side === 'Buy' ? '0' : '1', _qty: String(quantity), _price: String(price), _active: 'true', _accountId: accountId,
    'Fill ID': fillId, 'Order ID': orderId, Timestamp: displayTime, Date: '2/3/35', Account: account, 'B/S': ` ${side}`,
    Quantity: String(quantity), Price: String(price), _priceFormat: '-2', _priceFormatType: '0', _tickSize: '0.25',
    Contract: contract, Product: product, 'Product Description': 'Synthetic product, not a live trade', commission: '0.75', ...extra };
}
export function orderRow(extra = {}) {
  return { orderId: '900000000001001', Account: 'SYNTH-A', 'Order ID': '900000000001001', 'B/S': ' Buy', Contract: 'MESZ9', Product: 'MES',
    'Product Description': 'Synthetic product', avgPrice: '103.25', filledQty: '2', 'Fill Time': '02/03/2035 09:02:03',
    lastCommandId: '900000000001002', Status: ' Filled', _priceFormat: '-2', _priceFormatType: '0', _tickSize: '0.25', spreadDefinitionId: '',
    'Version ID': '900000000001002', Timestamp: '02/03/2035 09:01:03', Date: '2/3/35', Quantity: '2', Text: 'Synthetic "quoted", note', Type: ' Limit',
    'Limit Price': '103.25', 'Stop Price': '', decimalLimit: '103.25', decimalStop: '', 'Filled Qty': '2', 'Avg Fill Price': '103.25', decimalFillAvg: '103.25',
    Venue: '', 'Notional Value': '1,032.50', Currency: 'USD', ...extra };
}
export function positionRow(extra = {}) {
  return { 'Position ID': '900000000002001', Timestamp: '02/03/2035 09:12:03', 'Trade Date': '2035-02-03', 'Net Pos': '0', 'Net Price': '',
    Bought: '2', 'Avg. Buy': '103.25', Sold: '2', 'Avg. Sell': '102.00', Account: 'SYNTH-A', Contract: 'MESZ9', Product: 'MES', 'Product Description': 'Synthetic product',
    _priceFormat: '-2', _priceFormatType: '0', _tickSize: '0.25', 'Pair ID': '900000000002002', 'Buy Fill ID': '900000000000001',
    'Sell Fill ID': '900000000000002', 'Paired Qty': '2', 'Buy Price': '103.25', 'Sell Price': '102.00', 'P/L': '-12.50', Currency: 'USD',
    'Bought Timestamp': '02/03/2035 09:02:03', 'Sold Timestamp': '02/03/2035 09:12:03', ...extra };
}
export function makeCsv(headers, rows, { bom = false, newline = '\n', finalNewline = true } = {}) {
  const escape = value => /[",\r\n]/.test(String(value)) ? '"' + String(value).replaceAll('"', '""') + '"' : String(value);
  return (bom ? '\uFEFF' : '') + [headers, ...rows.map(row => headers.map(header => row[header] ?? ''))]
    .map(row => row.map(escape).join(',')).join(newline) + (finalNewline ? newline : '');
}
export const fillsCsv = (rows, options = {}) => makeCsv(options.headers || FILL_HEADERS, rows, options);
