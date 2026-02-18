import Head from 'next/head';
import { AdminAccessDenied } from '../../components/admin/access/AdminAccessDenied';
import { AdminAccessHeaderActions } from '../../components/admin/access/AdminAccessHeaderActions';
import { PageHeader } from '../../components/layout/PageHeader';
import { OrganizationsSection } from '../../components/admin/access/OrganizationsSection';
import { RolesSection } from '../../components/admin/access/RolesSection';
import { StatusBanners } from '../../components/admin/access/StatusBanners';
import { SummaryCards } from '../../components/admin/access/SummaryCards';
import { TenantsSection } from '../../components/admin/access/TenantsSection';
import { UsersSection } from '../../components/admin/access/UsersSection';
import { useAdminAccessPage } from '../../components/admin/access/hooks/useAdminAccessPage';
import {
  cardClass,
  checkboxClass,
  inputClass,
  labelClass,
  primaryBtnClass,
  secondaryBtnClass,
} from '../../components/admin/access-config';
import { localeDir, useUiLocale } from '../../lib/ui/locale';
import { getAuthMessages } from '../../lib/ui/i18n';

export default function AdminAccessPage() {
  const { locale, isRtl } = useUiLocale();
  const copy = getAuthMessages(locale).access;

  const {
    session,
    loading,
    loadingUsers,
    error,
    success,
    organizations,
    roles,
    tenantMappings,
    usersPage,
    setUsersPage,
    usersTotal,
    users,
    search,
    setSearch,
    usersTenantFilter,
    setUsersTenantFilter,
    usersTenantOrgFilter,
    setUsersTenantOrgFilter,
    orgForm,
    setOrgForm,
    roleForm,
    setRoleForm,
    tenantOrgDraft,
    setTenantOrgDraft,
    savingTenantName,
    userDraft,
    setUserDraft,
    savingUserKey,
    csrfToken,
    canManage,
    orgTree,
    pageCount,
    userFilterTenantOptions,
    onSubmitOrganization,
    onSubmitRole,
    saveTenantMapping,
    assignOrganization,
    assignRole,
  } = useAdminAccessPage(copy);

  if (session?.authenticated && session.user && !session.user.isAuthAdmin) {
    return (
      <>
        <Head>
          <title>{copy.headTitle}</title>
        </Head>
        <div className="space-y-6" dir={localeDir(locale)}>
          <PageHeader title={copy.title} subtitle={copy.subtitle} align={isRtl ? 'right' : 'left'} />
          <AdminAccessDenied copy={copy} />
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{copy.headTitle}</title>
      </Head>

      <div className="space-y-6" dir={localeDir(locale)}>
        <PageHeader
          title={copy.title}
          subtitle={copy.subtitle}
          align={isRtl ? 'right' : 'left'}
          actions={<AdminAccessHeaderActions copy={copy} secondaryBtnClass={secondaryBtnClass} />}
        />

        <StatusBanners error={error} success={success} />
        <div className="section-separator" />

        <SummaryCards
          copy={copy}
          cardClass={cardClass}
          loading={loading}
          loadingUsers={loadingUsers}
          organizationsCount={organizations.length}
          rolesCount={roles.length}
          mappedTenantsCount={tenantMappings.filter((item) => item.organizationRandId).length}
          usersTotal={usersTotal}
        />

        <div className="section-separator" />

        <OrganizationsSection
          copy={copy}
          cardClass={cardClass}
          labelClass={labelClass}
          inputClass={inputClass}
          checkboxClass={checkboxClass}
          primaryBtnClass={primaryBtnClass}
          orgForm={orgForm}
          setOrgForm={setOrgForm}
          organizations={organizations}
          orgTree={orgTree}
          onSubmitOrganization={onSubmitOrganization}
          csrfToken={csrfToken}
          canManage={canManage}
        />

        <div className="section-separator" />

        <RolesSection
          copy={copy}
          cardClass={cardClass}
          labelClass={labelClass}
          inputClass={inputClass}
          checkboxClass={checkboxClass}
          primaryBtnClass={primaryBtnClass}
          organizationsFirstRandId={organizations[0]?.randId || ''}
          roleForm={roleForm}
          setRoleForm={setRoleForm}
          roles={roles}
          orgTree={orgTree}
          onSubmitRole={onSubmitRole}
          csrfToken={csrfToken}
          canManage={canManage}
        />

        <div className="section-separator" />

        <TenantsSection
          copy={copy}
          cardClass={cardClass}
          inputClass={inputClass}
          secondaryBtnClass={secondaryBtnClass}
          isRtl={isRtl}
          tenantMappings={tenantMappings}
          orgTree={orgTree}
          tenantOrgDraft={tenantOrgDraft}
          setTenantOrgDraft={setTenantOrgDraft}
          saveTenantMapping={(tenantName) => {
            void saveTenantMapping(tenantName);
          }}
          savingTenantName={savingTenantName}
          csrfToken={csrfToken}
          canManage={canManage}
        />

        <div className="section-separator" />

        <UsersSection
          copy={copy}
          cardClass={cardClass}
          inputClass={inputClass}
          secondaryBtnClass={secondaryBtnClass}
          primaryBtnClass={primaryBtnClass}
          isRtl={isRtl}
          search={search}
          setSearch={setSearch}
          usersTenantFilter={usersTenantFilter}
          setUsersTenantFilter={setUsersTenantFilter}
          usersTenantOrgFilter={usersTenantOrgFilter}
          setUsersTenantOrgFilter={setUsersTenantOrgFilter}
          userFilterTenantOptions={userFilterTenantOptions}
          tenantMappings={tenantMappings}
          orgTree={orgTree}
          usersPage={usersPage}
          pageCount={pageCount}
          setUsersPage={setUsersPage}
          loadingUsers={loadingUsers}
          users={users}
          userDraft={userDraft}
          setUserDraft={setUserDraft}
          roles={roles}
          csrfToken={csrfToken}
          canManage={canManage}
          savingUserKey={savingUserKey}
          assignOrganization={(userRandId) => {
            void assignOrganization(userRandId);
          }}
          assignRole={(userRandId) => {
            void assignRole(userRandId);
          }}
        />
      </div>
    </>
  );
}
