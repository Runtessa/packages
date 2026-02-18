import { FormEvent } from 'react';
import { TwoFactorSetupState, formatDateTime } from '../config';
import { ProfileCopy, ProfileState } from './types';

type TwoFactorSectionProps = {
  copy: ProfileCopy;
  profile: ProfileState;
  cardClass: string;
  secondaryBtnClass: string;
  primaryBtnClass: string;
  inputClass: string;
  twoFaSaving: boolean;
  twoFaSetup: TwoFactorSetupState | null;
  twoFaCode: string;
  setTwoFaCode: (value: string) => void;
  twoFaQrDataUrl: string;
  twoFaQrLoading: boolean;
  twoFaQrError: string;
  onGenerateSetup: () => void;
  onEnable: (event: FormEvent) => void;
  onDisable: () => void;
};

export const TwoFactorSection = ({
  copy,
  profile,
  cardClass,
  secondaryBtnClass,
  primaryBtnClass,
  inputClass,
  twoFaSaving,
  twoFaSetup,
  twoFaCode,
  setTwoFaCode,
  twoFaQrDataUrl,
  twoFaQrLoading,
  twoFaQrError,
  onGenerateSetup,
  onEnable,
  onDisable,
}: TwoFactorSectionProps) => {
  return (
    <section id="section-two-factor" className="grid w-full grid-cols-1 gap-6 sm:w-[75%]">
      <article className={cardClass}>
        <h2 className="text-xl font-normal text-[#202124]">{copy.twoFactor.title}</h2>
        <div className="mt-4 space-y-4">
          <p className="text-sm text-[#5F6368]">
            {copy.twoFactor.status}:{' '}
            <span className="font-medium text-[#202124]">
              {profile.security.twoFactorEnabled ? copy.twoFactor.enabled : copy.twoFactor.disabled}
            </span>{' '}
            · {copy.twoFactor.method}:{' '}
            <span className="font-medium text-[#202124]">{copy.twoFactor.methodAuthenticator}</span> · {copy.twoFactor.updated}{' '}
            {formatDateTime(profile.security.updatedAt, copy.notSet)}
          </p>

          {!profile.security.twoFactorEnabled ? (
            <>
              <div className="rounded-2xl border border-[#DADCE0] bg-[#F8FAFF] p-4">
                <p className="text-sm text-[#202124]">{copy.twoFactor.setupSteps}</p>
                <div className="mt-3">
                  <button type="button" className={secondaryBtnClass} onClick={onGenerateSetup} disabled={twoFaSaving}>
                    {twoFaSaving ? copy.twoFactor.preparing : copy.twoFactor.generateSetupSecret}
                  </button>
                </div>
              </div>

              {twoFaSetup ? (
                <div className="space-y-4 rounded-2xl border border-[#DADCE0] bg-white p-4">
                  <div className="grid gap-4 md:grid-cols-[240px,1fr] md:items-start">
                    <div className="rounded-2xl border border-[#E8EAED] bg-white p-3">
                      <div className="grid place-items-center rounded-xl bg-[#F8F9FA] p-2">
                        {twoFaQrDataUrl ? (
                          <img src={twoFaQrDataUrl} alt={copy.twoFactor.qrAlt} className="h-[220px] w-[220px]" />
                        ) : (
                          <div className="grid h-[220px] w-[220px] place-items-center text-center text-xs text-[#5F6368]">
                            {twoFaQrLoading ? copy.twoFactor.qrGenerating : twoFaQrError || copy.twoFactor.qrNotReady}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <p className="text-sm text-[#202124]">{copy.twoFactor.scanHelp}</p>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.08em] text-[#5F6368]">
                          {copy.twoFactor.manualSetupKey}
                        </p>
                        <p className="mt-1 break-all font-mono text-sm text-[#202124]">{twoFaSetup.secret}</p>
                      </div>
                    </div>
                  </div>
                  <form className="space-y-3 border-t border-[#ECEFF3] pt-4" onSubmit={onEnable}>
                    <div>
                      <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.twoFactor.verificationCode}</label>
                      <input
                        className={`${inputClass} text-center font-mono tracking-[0.2em]`}
                        dir="ltr"
                        value={twoFaCode}
                        onChange={(event) => setTwoFaCode(event.target.value.replace(/\D+/g, '').slice(0, 6))}
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        minLength={6}
                        maxLength={6}
                        required
                      />
                    </div>
                    <button type="submit" className={primaryBtnClass} disabled={twoFaSaving}>
                      {twoFaSaving ? copy.twoFactor.enabling : copy.twoFactor.enableAction}
                    </button>
                  </form>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl border border-[#DADCE0] bg-white p-4">
              <p className="text-sm text-[#5F6368]">{copy.twoFactor.activeDescription}</p>
              <div className="mt-3">
                <button type="button" className={secondaryBtnClass} onClick={onDisable} disabled={twoFaSaving}>
                  {twoFaSaving ? copy.twoFactor.disabling : copy.twoFactor.disableAction}
                </button>
              </div>
            </div>
          )}
        </div>
      </article>
    </section>
  );
};
