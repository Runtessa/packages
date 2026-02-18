import { useEffect } from 'react';

export const useDebouncedSearchSync = (
  search: string,
  setDebouncedSearch: (value: string) => void,
  setUsersPage: (value: number) => void,
): void => {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setUsersPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, setDebouncedSearch, setUsersPage]);
};

export const useTenantOrgFilterGuard = (
  usersTenantFilter: string,
  usersTenantOrgFilter: string,
  setUsersTenantOrgFilter: (value: string) => void,
  orgTree: Array<{ org: { randId: string } }>,
): void => {
  useEffect(() => {
    if (!usersTenantFilter) {
      if (usersTenantOrgFilter) setUsersTenantOrgFilter('');
      return;
    }
    if (usersTenantOrgFilter && !orgTree.some((node) => node.org.randId === usersTenantOrgFilter)) {
      setUsersTenantOrgFilter('');
    }
  }, [orgTree, usersTenantFilter, usersTenantOrgFilter, setUsersTenantOrgFilter]);
};
