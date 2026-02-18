import { useEffect, useState } from 'react';

export const useOtpCooldown = () => {
  const [otpWaitUntilMs, setOtpWaitUntilMs] = useState(0);
  const [resendRemainingSec, setResendRemainingSec] = useState(0);

  useEffect(() => {
    if (!otpWaitUntilMs || otpWaitUntilMs <= 0) {
      setResendRemainingSec(0);
      return;
    }
    const update = () => {
      const remainingMs = otpWaitUntilMs - Date.now();
      setResendRemainingSec(remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [otpWaitUntilMs]);

  return {
    otpWaitUntilMs,
    setOtpWaitUntilMs,
    resendRemainingSec,
  };
};
