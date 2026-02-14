const STORAGE_KEY = 'selectedTenantHost';

export const getSelectedTenantHost = () => {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(STORAGE_KEY) || '';
};

export const setSelectedTenantHost = (value: string) => {
  if (typeof window === 'undefined') return;
  if (value) {
    localStorage.setItem(STORAGE_KEY, value);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
};

export { STORAGE_KEY as TENANT_STORAGE_KEY };
