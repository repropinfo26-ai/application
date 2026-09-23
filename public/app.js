const form = document.getElementById('application-form');
const steps = [...document.querySelectorAll('.step')];
const errorBox = document.getElementById('form-error');
const backButton = document.getElementById('back');
const nextButton = document.getElementById('next');
const submitButton = document.getElementById('submit');
const canvas = document.getElementById('signature');
const signatureBox = canvas.parentElement;
const context = canvas.getContext('2d');

let currentStep = 0;
let hasSignature = false;
let drawing = false;
let submitting = false;
let requestId = crypto.randomUUID?.() || `req-${Date.now()}-${Math.random()}`;

function field(name) { return form.elements.namedItem(name); }

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function showStep(index, scroll = true) {
  currentStep = index;
  steps.forEach((step, i) => {
    const active = i === index;
    step.classList.toggle('active', active);
    step.hidden = !active;
  });
  document.getElementById('step-count').textContent =
    `STEP ${String(index + 1).padStart(2, '0')} OF 04`;
  document.getElementById('progress-fill').style.width = `${(index + 1) * 25}%`;
  backButton.hidden = index === 0;
  nextButton.hidden = index === steps.length - 1;
  submitButton.hidden = index !== steps.length - 1;
  clearError();
  if (index === 3) requestAnimationFrame(resizeCanvas);
  if (scroll) document.querySelector('.form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateMentorFields() {
  const needsMentor = field('mentorRequired').value === 'Yes';
  document.getElementById('mentor-fields').hidden = !needsMentor;
  field('mentorName').required = needsMentor;
  field('mentorContact').required = needsMentor;
}

function updateFfcFields() {
  field('ffcNumber').required = field('ffcStatus').value === 'Current FFC';
}

function updateSplit(agentField, companyField) {
  const raw = field(agentField).value;
  const amount = Number(raw);
  field(companyField).value = raw !== '' && Number.isFinite(amount) &&
    amount >= 0 && amount <= 100
    ? String(Number((100 - amount).toFixed(2)))
    : '';
}

function validCurrentStep() {
  if (currentStep === 1) {
    updateMentorFields();
    updateFfcFields();
  }
  if (currentStep === 2) {
    updateSplit('salesAgent', 'salesCompany');
    updateSplit('rentalsAgent', 'rentalsCompany');
  }

  const inputs = steps[currentStep].querySelectorAll('input, select, textarea');
  for (const input of inputs) {
    if (input.closest('[hidden]')) continue;
    if (!input.checkValidity()) {
      input.reportValidity();
      return false;
    }
  }

  if (currentStep === 3 && !hasSignature) {
    showError('Please sign inside the signature box.');
    return false;
  }
  return true;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const previous = hasSignature ? canvas.toDataURL('image/png') : null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.strokeStyle = '#1a2e4b';
  context.fillStyle = '#1a2e4b';
  context.lineWidth = 2.3;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (previous) {
    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
    image.src = previous;
  }
}

function point(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

canvas.addEventListener('pointerdown', event => {
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  drawing = true;
  hasSignature = true;
  signatureBox.classList.add('signed');
  const { x, y } = point(event);
  context.beginPath();
  context.arc(x, y, 1.15, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.moveTo(x, y);
});

canvas.addEventListener('pointermove', event => {
  if (!drawing) return;
  event.preventDefault();
  const { x, y } = point(event);
  context.lineTo(x, y);
  context.stroke();
});

for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(name, () => { drawing = false; });
}

document.getElementById('clear-signature').addEventListener('click', () => {
  context.clearRect(0, 0, canvas.width, canvas.height);
  hasSignature = false;
  signatureBox.classList.remove('signed');
});

window.addEventListener('resize', () => {
  if (currentStep === 3) resizeCanvas();
});

form.querySelectorAll('[name="mentorRequired"]').forEach(input =>
  input.addEventListener('change', updateMentorFields));
field('ffcStatus').addEventListener('change', updateFfcFields);
field('salesAgent').addEventListener('input', () => updateSplit('salesAgent', 'salesCompany'));
field('rentalsAgent').addEventListener('input', () => updateSplit('rentalsAgent', 'rentalsCompany'));

for (const [inputName, outputName, cardId] of [
  ['photo', 'photo-name', 'photo-card'],
  ['idDocument', 'id-name', 'id-card'],
]) {
  field(inputName).addEventListener('change', () => {
    const file = field(inputName).files[0];
    document.getElementById(outputName).textContent = file?.name || 'Choose file';
    document.getElementById(cardId).classList.toggle('ready', Boolean(file));
    clearError();
  });
}

nextButton.addEventListener('click', () => {
  clearError();
  if (validCurrentStep()) showStep(currentStep + 1);
});

backButton.addEventListener('click', () => showStep(currentStep - 1));

function fileType(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return file.type || ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[extension] || '');
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('A file could not be read. Please select it again.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('An image could not be opened.')); };
    image.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image preparation failed.')),
      'image/jpeg', quality));
}

async function prepareImage(file, maxBytes, maxSide) {
  if (file.size <= maxBytes && ['image/jpeg', 'image/png', 'image/webp'].includes(fileType(file))) {
    return file;
  }
  const image = await loadImage(file);
  let scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  for (let attempt = 0; attempt < 7; attempt++) {
    const converted = document.createElement('canvas');
    converted.width = Math.max(1, Math.round(image.naturalWidth * scale));
    converted.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const painter = converted.getContext('2d');
    painter.fillStyle = '#ffffff';
    painter.fillRect(0, 0, converted.width, converted.height);
    painter.drawImage(image, 0, 0, converted.width, converted.height);
    const blob = await canvasToBlob(converted, Math.max(0.72, 0.9 - attempt * 0.03));
    if (blob.size <= maxBytes) return blob;
    scale *= 0.85;
  }
  throw new Error('An image is too large. Please choose a clearer, smaller image.');
}

async function prepareFiles() {
  const photoOriginal = field('photo').files[0];
  const idOriginal = field('idDocument').files[0];
  if (!photoOriginal || !idOriginal) throw new Error('Please upload both your photo and ID.');
  if (photoOriginal.size > 20_000_000 || idOriginal.size > 20_000_000) {
    throw new Error('Please choose files smaller than 20 MB before preparation.');
  }
  const photoType = fileType(photoOriginal);
  const idType = fileType(idOriginal);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(photoType)) {
    throw new Error('The applicant photo must be a JPG, PNG or WebP image.');
  }
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(idType)) {
    throw new Error('The ID copy must be an image or PDF.');
  }

  const photo = await prepareImage(photoOriginal, 900_000, 1800);
  let idDocument;
  if (idType === 'application/pdf') {
    if (idOriginal.size > 2_400_000) {
      throw new Error('The ID PDF must be 2.4 MB or less. Please compress it or upload a clear photograph.');
    }
    idDocument = idOriginal;
  } else {
    idDocument = await prepareImage(idOriginal, 2_400_000, 2400);
  }
  if (photo.size + idDocument.size > 3_500_000) {
    throw new Error('The combined files are too large. Please use a smaller ID file.');
  }

  const signature = canvas.toDataURL('image/png');
  return {
    photo: { base64: await readAsDataURL(photo) },
    idDocument: { base64: await readAsDataURL(idDocument) },
    signature: { base64: signature },
  };
}

function applicationData() {
  return {
    name: field('name').value.trim(),
    surname: field('surname').value.trim(),
    idNumber: field('idNumber').value.trim(),
    contactNumber: field('contactNumber').value.trim(),
    address: field('address').value.trim(),
    preferredEmail: field('emailLocal').value.trim().toLowerCase() + '@reprop.co.za',
    ffcStatus: field('ffcStatus').value,
    ffcNumber: field('ffcNumber').value.trim(),
    ffcExpiry: field('ffcExpiry').value,
    mentorRequired: field('mentorRequired').value === 'Yes',
    mentorName: field('mentorName').value.trim(),
    mentorFfcNumber: field('mentorFfcNumber').value.trim(),
    mentorContact: field('mentorContact').value.trim(),
    mentorEmail: field('mentorEmail').value.trim(),
    salesAgent: Number(field('salesAgent').value),
    salesCompany: Number(field('salesCompany').value),
    rentalsAgent: Number(field('rentalsAgent').value),
    rentalsCompany: Number(field('rentalsCompany').value),
    agreed: field('agreed').checked,
  };
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  clearError();
  if (!validCurrentStep()) return;

  submitting = true;
  submitButton.disabled = true;
  backButton.disabled = true;
  submitButton.firstChild.textContent = 'Preparing documents ';
  form.setAttribute('aria-busy', 'true');

  try {
    const files = await prepareFiles();
    const payload = {
      requestId,
      website: '',
      application: applicationData(),
      ...files,
    };
    const encoded = JSON.stringify(payload);
    if (new TextEncoder().encode(encoded).byteLength > 5_400_000) {
      throw new Error('The combined files are too large. Please use smaller images or a smaller ID PDF.');
    }

    submitButton.firstChild.textContent = 'Submitting application ';
    const response = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: encoded,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || 'The application could not be submitted. Please try again.');
    }
    document.getElementById('application-id').textContent = result.applicationId;
    document.getElementById('application-view').hidden = true;
    const success = document.getElementById('success-view');
    success.hidden = false;
    success.focus();
    success.scrollIntoView({ behavior: 'smooth', block: 'start' });
    requestId = crypto.randomUUID?.() || `req-${Date.now()}-${Math.random()}`;
  } catch (error) {
    showError(error.message || 'Submission failed. Please try again.');
  } finally {
    submitting = false;
    submitButton.disabled = false;
    backButton.disabled = false;
    submitButton.firstChild.textContent = 'Sign & submit ';
    form.removeAttribute('aria-busy');
  }
});

updateMentorFields();
updateFfcFields();
showStep(0, false);
