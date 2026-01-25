
export const normalizePhoneNumber = (phoneNumber: string): string => {
  if (!phoneNumber) return '';

  let countryCode = process.env.COUNTRY_CODE || '+';
  if (!countryCode.startsWith('+')) {
      countryCode = '+' + countryCode;
  }

  // If the phone number already starts with '+', assume it has a country code
  if (phoneNumber.startsWith('+')) {
      return phoneNumber;
  }

  let cleanPhone = phoneNumber.trim();
  // Strip leading zero if present, as we are adding a country code
  if (cleanPhone.startsWith('0')) {
      cleanPhone = cleanPhone.substring(1);
  }

  return `${countryCode}${cleanPhone}`;
};
