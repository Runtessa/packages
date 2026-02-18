import { getAuthMessages } from '../../../lib/ui/i18n';
import { ProfilePayload } from '../config';

export type ProfileCopy = ReturnType<typeof getAuthMessages>['profile'];
export type ProfileState = ProfilePayload['profile'];
