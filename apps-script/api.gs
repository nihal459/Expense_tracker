/**
 * JSON feed for the React dashboard.
 * Paste this file into the same Apps Script project as the dashboard builder, then
 * Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
 * Put the /exec URL in expense-app/.env.local as VITE_SHEET_API_URL.
 *
 * Returns { version, updated, rows: [{ date: 'yyyy-mm-dd', category, amount, payment, remarks }] }.
 * With ?check=1 it returns only { version }, a fingerprint that changes whenever a row
 * is added, edited or deleted, so the app can skip downloading unchanged data.
 * Dates are fixed the same way as _DashData!P: the sheet locale is US, so dd/mm/yyyy
 * entries are stored with day and month swapped, or as text when day > 12.
 *
 * Password: every request must send ?key=<password>. Set it in Project Settings >
 * Script Properties as DASH_PASSWORD. It stays on Google's side, never in the app.
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var password = PropertiesService.getScriptProperties().getProperty('DASH_PASSWORD');
  if (!password || p.key !== password) return apiJson_(JSON.stringify({ error: 'unauthorized' }));

  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(DASH_SPREADSHEET_ID);
  var values = ss.getSheetByName(DASH_SOURCE).getDataRange().getValues();
  var headers = values.shift().map(function (h) { return String(h).trim().toUpperCase(); });
  function col(name) {
    for (var i = 0; i < headers.length; i++) if (headers[i].indexOf(name) === 0) return i;
    throw new Error('"' + DASH_SOURCE + '" row 1 is missing the heading ' + name);
  }
  var c = { date: col('DATE'), category: col('CATEGORY'), amount: col('AMOUNT'), payment: col('PAYMENT'), remarks: col('REMARK') };
  var tz = ss.getSpreadsheetTimeZone();

  var rows = [];
  values.forEach(function (r) {
    var date = apiDate_(r[c.date], tz);
    if (!date || typeof r[c.amount] !== 'number') return;
    rows.push({
      date: date,
      category: String(r[c.category]).trim(),
      amount: r[c.amount],
      payment: String(r[c.payment]).trim() || 'Not set',
      remarks: String(r[c.remarks]).trim()
    });
  });

  var json = JSON.stringify(rows);
  var version = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, json));
  return apiJson_(p.check
    ? JSON.stringify({ version: version })
    : '{"version":"' + version + '","updated":"' + new Date().toISOString() + '","rows":' + json + '}');
}

function apiJson_(body) {
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function apiDate_(v, tz) {
  if (v instanceof Date) {
    var p = Utilities.formatDate(v, tz, 'yyyy-MM-dd').split('-');
    return apiIso_(+p[0], +p[2], +p[1]);   // stored day is the real month
  }
  var m = String(v).trim().match(/^(\d+)\/(\d+)\/(\d{4})/);
  return m ? apiIso_(+m[3], +m[2], +m[1]) : null;
}

function apiIso_(y, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return y + '-' + ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2);
}
