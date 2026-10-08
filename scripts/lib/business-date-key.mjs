export function businessDateKeyInTimeZone(date, timeZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Tanggal business-date probe tidak valid.');
  }
  const zone = String(timeZone || '').trim();
  if (!zone) throw new Error('Timezone perusahaan wajib tersedia untuk business-date probe.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!/^\d{4}$/.test(values.year || '') || !/^\d{2}$/.test(values.month || '') || !/^\d{2}$/.test(values.day || '')) {
    throw new Error(`Gagal menentukan tanggal bisnis untuk timezone ${zone}.`);
  }
  return `${values.year}-${values.month}-${values.day}`;
}

export function companyTimeZoneFromBranchContext(branchContext) {
  const timeZone = String(branchContext?.company?.timezone || '').trim();
  if (!timeZone) throw new Error('Branch context tidak menyediakan company.timezone.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw new Error(`Company timezone tidak valid: ${timeZone}`);
  }
  return timeZone;
}
