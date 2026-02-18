import { UiLocale } from './locale';
import { enMessages } from './i18n/messages/en';
import { faMessages } from './i18n/messages/fa';
import { deMessages } from './i18n/messages/de';
import { arMessages } from './i18n/messages/ar';

const AUTH_MESSAGES = {
  en: enMessages,
  fa: faMessages,
  de: deMessages,
  ar: arMessages,
} as const;

export type AuthMessages = typeof enMessages;

export const getAuthMessages = (locale: UiLocale): AuthMessages => {
  return (AUTH_MESSAGES[locale] || AUTH_MESSAGES.en) as AuthMessages;
};
