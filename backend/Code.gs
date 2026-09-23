/**
 * RE PROP AGENT APPLICATION - GOOGLE APPS SCRIPT BACKEND
 * Run setup() once as the owner, then deploy as a web app.
 * The future Netlify function must POST JSON to the /exec URL with apiKey.
 * Do not put the apiKey in browser code or a public GitHub repository.
 */

const CONFIG = Object.freeze({
  spreadsheetId: '1DKns7bvYoyNEfB6vbWBFi_OtpobnU8T3S7T4spcalsM',
  parentFolderId: '1lbtPEOTsXDarD42HtgTm-OutwLV0DsC2',
  sheetName: 'Applications',
  timeZone: 'Africa/Johannesburg',
  maxPhotoBytes: 5 * 1024 * 1024,
  maxIdBytes: 8 * 1024 * 1024,
  maxSignatureBytes: 1024 * 1024
});

const NOTIFICATION_RECIPIENTS = [
  'repropinfo26@gmail.com',
  'tshidimunyai@gmail.com'
];

const HEADERS = [
  'Submitted (SAST)', 'Request ID', 'Application ID', 'Status',
  'Name', 'Surname', 'ID number', 'Contact number', 'Residential address',
  'Preferred Re Prop email', 'FFC status', 'FFC number', 'FFC expiry date',
  'Mentor required', 'Mentor name', 'Mentor FFC number', 'Mentor contact',
  'Mentor email', 'Sales agent %', 'Sales Re Prop %', 'Rentals agent %',
  'Rentals Re Prop %', 'Applicant signed (SAST)', 'Mentor signed (SAST)',
  'Applicant folder', 'Applicant photo', 'ID document',
  'Signed application PDF', 'Editable application document',
  'Email to repropinfo26@gmail.com', 'Email to tshidimunyai@gmail.com'
];

/** Run manually once. Does not clear or change existing sheets. */
function setup() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const root = DriveApp.getFolderById(CONFIG.parentFolderId);
  const sheet = getApplicationsSheet_(spreadsheet);
  let key = PropertiesService.getScriptProperties().getProperty('APPLICATION_API_KEY');
  if (!key) {
    key = Utilities.getUuid() + Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperty('APPLICATION_API_KEY', key);
    Logger.log('Save this API key privately for the Netlify environment variable: %s', key);
  } else {
    Logger.log('API key already exists. Run showApiKey() if you need to retrieve it.');
  }
  Logger.log('Ready. Sheet: %s | Parent folder: %s', sheet.getName(), root.getName());
}

/** Run manually as the script owner only. Never paste the output into GitHub. */
function showApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('APPLICATION_API_KEY');
  if (!key) throw new Error('Run setup() first.');
  Logger.log('APPLICATION_API_KEY: %s', key);
}

function doGet() {
  return json_({ ok: true, service: 'Re Prop agent applications' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Empty request.');
    const payload = JSON.parse(e.postData.contents);
    const storedKey = PropertiesService.getScriptProperties().getProperty('APPLICATION_API_KEY');
    if (!storedKey || !payload || payload.apiKey !== storedKey) {
      throw new Error('Not authorised.');
    }
    return json_(saveApplication_(payload));
  } catch (error) {
    // ContentService cannot reliably choose an HTTP error status; callers must read ok.
    Logger.log('Application error: %s', error && error.stack ? error.stack : error);
    return json_({ ok: false, error: String(error.message || error) });
  }
}

function saveApplication_(payload) {
  // Validate and decode before writing anything to Drive or Sheets.
  const applicant = validateApplication_(payload);
  const photo = decodeUpload_(payload.photo, 'Applicant photo', CONFIG.maxPhotoBytes, ['image/jpeg', 'image/png', 'image/webp']);
  const idCopy = decodeUpload_(payload.idDocument, 'ID document', CONFIG.maxIdBytes, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  const signature = decodeUpload_(payload.signature, 'Applicant signature', CONFIG.maxSignatureBytes, ['image/png']);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getApplicationsSheet_(SpreadsheetApp.openById(CONFIG.spreadsheetId));
    const prior = sheet.getRange(2, 2, Math.max(1, sheet.getLastRow() - 1), 1)
      .createTextFinder(applicant.requestId).matchEntireCell(true).findNext();
    if (prior && prior.getRow() <= sheet.getLastRow()) {
      const oldRow = sheet.getRange(prior.getRow(), 1, 1, HEADERS.length).getValues()[0];
      return { ok: true, duplicate: true, applicationId: oldRow[2] };
    }

    const now = new Date();
    const submittedAt = Utilities.formatDate(now, CONFIG.timeZone, 'yyyy-MM-dd HH:mm:ss');
    const applicationId = 'APP-' + Utilities.formatDate(now, CONFIG.timeZone, 'yyyyMMdd') + '-' + Utilities.getUuid().slice(0, 8).toUpperCase();
    const folderName = safeFileName_(applicant.name + ' ' + applicant.surname) + ' - ' + applicationId;
    const folder = DriveApp.getFolderById(CONFIG.parentFolderId).createFolder(folderName);

    // Store originals as private files; sharing inherits the parent folder's permissions.
    const photoFile = folder.createFile(photo.blob.setName('Applicant photo.' + photo.extension));
    const idFile = folder.createFile(idCopy.blob.setName('ID document.' + idCopy.extension));
    const document = createApplicationDocument_(applicant, applicationId, submittedAt, signature.blob, folder);
    const docFile = DriveApp.getFileById(document.getId());
    const pdfFile = folder.createFile(docFile.getAs(MimeType.PDF)
      .setName('Signed Agent Application - ' + applicationId + '.pdf'));

    const row = [
      submittedAt, applicant.requestId, applicationId, 'Submitted - approval pending',
      applicant.name, applicant.surname, applicant.idNumber, applicant.contactNumber,
      applicant.address, applicant.preferredEmail, applicant.ffcStatus, applicant.ffcNumber,
      applicant.ffcExpiry, applicant.mentorRequired ? 'Yes' : 'No',
      applicant.mentorName, applicant.mentorFfcNumber, applicant.mentorContact,
      applicant.mentorEmail, applicant.salesAgent, applicant.salesCompany,
      applicant.rentalsAgent, applicant.rentalsCompany, submittedAt,
      '', folder.getUrl(), photoFile.getUrl(),
      idFile.getUrl(), pdfFile.getUrl(), docFile.getUrl(), '', ''
    ];
    const nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, HEADERS.length).setNumberFormat('@');
    sheet.getRange(nextRow, 1, 1, HEADERS.length).setValues([row.map(sheetSafe_)]);
    SpreadsheetApp.flush();
    try {
      sendNotificationsForRow_(sheet, nextRow);
    } catch (error) {
      // The application is already saved. A mail problem must not prompt a duplicate submission.
      Logger.log('Email notification issue for %s: %s', applicationId, error);
      try { sheet.getRange(nextRow, 4).setValue('Submitted - email issue'); } catch (_) {}
    }
    return { ok: true, applicationId: applicationId };
  } finally {
    lock.releaseLock();
  }
}

function getApplicationsSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CONFIG.sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.sheetName);
  if (sheet.getMaxColumns() < HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  }
  const existing = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  if (existing.every(function (v) { return v === ''; })) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#17324d').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  } else if (HEADERS.slice(0, 29).some(function (header, index) { return existing[index] !== header; })) {
    throw new Error('The Applications tab has different headers. Use a fresh tab or correct the header row.');
  } else if (existing[29] === '' && existing[30] === '') {
    // Upgrade the tab created by the previous backend without changing any application rows.
    sheet.getRange(1, 30, 1, 2).setValues([HEADERS.slice(29)]);
    sheet.getRange(1, 30, 1, 2).setFontWeight('bold').setBackground('#17324d').setFontColor('#ffffff');
  } else if (existing[29] !== HEADERS[29] || existing[30] !== HEADERS[30]) {
    throw new Error('The Applications tab has different email-status headers.');
  }
  return sheet;
}

/** Run manually if any application has an unsent or failed email notification. */
function retryFailedEmails() {
  const sheet = getApplicationsSheet_(SpreadsheetApp.openById(CONFIG.spreadsheetId));
  for (let row = 2; row <= sheet.getLastRow(); row++) {
    const values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    if (values[2] && (values[29] !== 'Sent' || values[30] !== 'Sent')) {
      sendNotificationsForRow_(sheet, row);
    }
  }
}

function sendNotificationsForRow_(sheet, rowNumber) {
  const values = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
  const pdfUrl = String(values[27] || '');
  const match = pdfUrl.match(/\/d\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('Signed application PDF URL is missing.');
  const attachment = DriveApp.getFileById(match[1]).getBlob();
  const applicantName = singleLine_(String(values[4] || '') + ' ' + String(values[5] || ''));
  const applicationId = String(values[2] || '');
  const subject = 'Re Prop agent application - ' + applicantName + ' - ' + applicationId;
  const body =
    'A new Re Prop agent application has been submitted.\n\n' +
    'Applicant: ' + applicantName + '\n' +
    'Reference: ' + applicationId + '\n' +
    'Submitted (SAST): ' + String(values[0] || '') + '\n\n' +
    'The signed application PDF is attached. The applicant photo and ID copy are in the restricted applicant folder:\n' +
    String(values[24] || '') + '\n\n' +
    'This message was sent automatically by the Re Prop application system.';

  NOTIFICATION_RECIPIENTS.forEach(function (recipient, index) {
    const statusColumn = 30 + index;
    if (values[29 + index] === 'Sent') return;
    try {
      if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Email quota reached');
      MailApp.sendEmail({
        to: recipient,
        subject: subject,
        body: body,
        name: 'Re Prop Agent Applications',
        attachments: [attachment]
      });
      sheet.getRange(rowNumber, statusColumn).setValue('Sent');
    } catch (error) {
      Logger.log('Email to %s for %s failed: %s', recipient, applicationId, error);
      sheet.getRange(rowNumber, statusColumn).setValue('Failed: ' + String(error.message || error).slice(0, 160));
    }
  });

  const emailStatuses = sheet.getRange(rowNumber, 30, 1, 2).getValues()[0];
  sheet.getRange(rowNumber, 4).setValue(emailStatuses.every(function (status) { return status === 'Sent'; })
    ? 'Submitted - approval pending' : 'Submitted - email issue');
  SpreadsheetApp.flush();
}

function singleLine_(value) {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
}

function validateApplication_(p) {
  const a = p.application || {};
  const out = {
    requestId: required_(p.requestId, 'Request ID', 100),
    name: required_(a.name, 'Name', 80),
    surname: required_(a.surname, 'Surname', 80),
    idNumber: required_(a.idNumber, 'ID number', 40),
    contactNumber: required_(a.contactNumber, 'Contact number', 40),
    address: required_(a.address, 'Residential address', 500),
    preferredEmail: required_(a.preferredEmail, 'Preferred Re Prop email', 100).toLowerCase(),
    ffcStatus: required_(a.ffcStatus, 'FFC status', 30),
    ffcNumber: optional_(a.ffcNumber, 60),
    ffcExpiry: optional_(a.ffcExpiry, 30),
    mentorRequired: a.mentorRequired === true || a.mentorRequired === 'Yes',
    mentorName: optional_(a.mentorName, 120),
    mentorFfcNumber: optional_(a.mentorFfcNumber, 60),
    mentorContact: optional_(a.mentorContact, 40),
    mentorEmail: optional_(a.mentorEmail, 120),
    salesAgent: percent_(a.salesAgent, 'Sales agent share'),
    salesCompany: percent_(a.salesCompany, 'Sales Re Prop share'),
    rentalsAgent: percent_(a.rentalsAgent, 'Rentals agent share'),
    rentalsCompany: percent_(a.rentalsCompany, 'Rentals Re Prop share')
  };
  if (!/^[-a-z0-9._]+@reprop\.co\.za$/.test(out.preferredEmail)) {
    throw new Error('Preferred email must end with @reprop.co.za.');
  }
  if (['Current FFC', 'No FFC', 'Pending'].indexOf(out.ffcStatus) === -1) {
    throw new Error('Choose Current FFC, No FFC or Pending.');
  }
  if (out.ffcStatus === 'Current FFC' && !out.ffcNumber) throw new Error('FFC number is required for a current FFC.');
  if (out.mentorRequired && (!out.mentorName || !out.mentorContact)) {
    throw new Error('Mentor name and contact are required when a mentor is needed.');
  }
  if (out.mentorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.mentorEmail)) throw new Error('Mentor email is invalid.');
  if (Math.abs(out.salesAgent + out.salesCompany - 100) > 0.001 ||
      Math.abs(out.rentalsAgent + out.rentalsCompany - 100) > 0.001) {
    throw new Error('Agent and Re Prop percentages must total 100% for both sales and rentals.');
  }
  if (a.agreed !== true) throw new Error('The applicant must confirm the information and sign.');
  return out;
}

function required_(value, label, maxLength) {
  const text = String(value == null ? '' : value).trim();
  if (!text || text.length > maxLength) throw new Error(label + ' is required (maximum ' + maxLength + ' characters).');
  return text;
}

function optional_(value, maxLength) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > maxLength) throw new Error('A field exceeds ' + maxLength + ' characters.');
  return text;
}

function percent_(value, label) {
  if (value === '' || value === null || typeof value === 'undefined') throw new Error(label + ' is required.');
  const number = Number(value);
  if (!isFinite(number) || number < 0 || number > 100 ||
      Math.abs(Math.round(number * 100) - number * 100) > 0.000001) {
    throw new Error(label + ' must be a percentage between 0 and 100 with at most two decimal places.');
  }
  return number;
}

function decodeUpload_(input, label, maxBytes, allowedTypes) {
  if (!input || typeof input.base64 !== 'string') throw new Error(label + ' is required.');
  const base64 = input.base64.replace(/^data:[^,]+,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new Error(label + ' is invalid or too large.');
  }
  const bytes = Utilities.base64Decode(base64);
  if (!bytes.length || bytes.length > maxBytes) throw new Error(label + ' exceeds the size limit.');
  const b = bytes.map(function (n) { return n & 255; });
  let mimeType = '';
  let extension = '';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) { mimeType = 'image/jpeg'; extension = 'jpg'; }
  else if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10) { mimeType = 'image/png'; extension = 'png'; }
  else if (b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70 && b[8] === 87 && b[9] === 69 && b[10] === 66 && b[11] === 80) { mimeType = 'image/webp'; extension = 'webp'; }
  else if (b[0] === 37 && b[1] === 80 && b[2] === 68 && b[3] === 70 && b[4] === 45) { mimeType = 'application/pdf'; extension = 'pdf'; }
  if (allowedTypes.indexOf(mimeType) === -1) throw new Error(label + ' must be ' + allowedTypes.join(', ') + '.');
  return { blob: Utilities.newBlob(bytes, mimeType, label + '.' + extension), extension: extension };
}

function createApplicationDocument_(a, id, submittedAt, signatureBlob, folder) {
  const doc = DocumentApp.create('Agent Application - ' + id);
  const body = doc.getBody();
  body.setMarginTop(42).setMarginBottom(42).setMarginLeft(48).setMarginRight(48);
  body.appendParagraph('RE PROP | AGENT APPLICATION FORM')
    .setHeading(DocumentApp.ParagraphHeading.TITLE).editAsText().setForegroundColor('#17324d');
  body.appendParagraph('Applicant details and agreed commercial terms')
    .editAsText().setForegroundColor('#51606c');
  body.appendParagraph('Application ID: ' + id + '   |   Submitted: ' + submittedAt + ' SAST');
  body.appendParagraph('This application is subject to Re Prop approval and completion of any required onboarding agreement.');

  section_(body, 'Applicant details');
  table_(body, [
    ['Name', a.name, 'Surname', a.surname],
    ['ID number', a.idNumber, 'Contact number', a.contactNumber],
    ['Residential address', a.address, 'Preferred Re Prop email', a.preferredEmail]
  ]);
  section_(body, 'FFC and mentor details');
  table_(body, [
    ['FFC status', a.ffcStatus, 'Mentor required', a.mentorRequired ? 'Yes' : 'No'],
    ['FFC number', a.ffcNumber || '-', 'Expiry date', a.ffcExpiry || '-'],
    ['Mentor name', a.mentorName || '-', 'Mentor FFC no', a.mentorFfcNumber || '-'],
    ['Mentor contact', a.mentorContact || '-', 'Mentor email', a.mentorEmail || '-']
  ]);
  section_(body, 'Commission splits');
  body.appendParagraph('The agent and Re Prop percentages for each line total 100%.');
  table_(body, [
    ['Business type', 'Agent share', 'Re Prop share'],
    ['Sales', String(a.salesAgent) + '%', String(a.salesCompany) + '%'],
    ['Rentals', String(a.rentalsAgent) + '%', String(a.rentalsCompany) + '%']
  ]);
  section_(body, 'Signatures');
  body.appendParagraph('Applicant declaration: I confirm that the information submitted is accurate and that I agree to the commercial terms recorded above.');
  body.appendParagraph('Agent applicant: ' + a.name + ' ' + a.surname);
  signatureImage_(body, signatureBlob);
  body.appendParagraph('Signed electronically on ' + submittedAt + ' SAST');
  if (a.mentorRequired) {
    body.appendParagraph('Mentor: ' + a.mentorName);
    body.appendParagraph('Signature: __________________________________   Date: _______________');
  }
  body.appendParagraph('Dawie du Toit | Approval: __________________________   Date: _______________');
  body.appendParagraph('Elandre Potgieter | Approval: _______________________   Date: _______________');
  body.appendParagraph('RE PROP | Agent Application Form | ' + id).editAsText().setForegroundColor('#51606c');
  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(folder);
  return doc;
}

function section_(body, text) {
  body.appendParagraph(text).setHeading(DocumentApp.ParagraphHeading.HEADING2)
    .editAsText().setForegroundColor('#17324d');
}

function table_(body, rows) {
  const table = body.appendTable(rows);
  table.setBorderColor('#d5dee6');
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const cell = table.getCell(r, c);
      cell.setPaddingTop(4).setPaddingBottom(4);
      if ((rows[r].length === 4 && c % 2 === 0) || (rows[r].length === 3 && r === 0)) {
        cell.setBackgroundColor('#edf3f7');
        cell.editAsText().setBold(true);
      }
    }
  }
}

function signatureImage_(body, blob) {
  const image = body.appendImage(blob);
  const ratio = Math.min(210 / image.getWidth(), 70 / image.getHeight(), 1);
  const width = image.getWidth();
  const height = image.getHeight();
  image.setWidth(Math.round(width * ratio));
  image.setHeight(Math.round(height * ratio));
}

function safeFileName_(name) {
  return name.replace(/[\\/<>:"|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function sheetSafe_(value) {
  if (typeof value === 'string' && /^[\s]*[=+@\-]/.test(value)) return "'" + value;
  return value;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
