import { getAuthMessages } from '../../../lib/ui/i18n';

export type LoginCopy = ReturnType<typeof getAuthMessages>['login'];
