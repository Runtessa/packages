import { config } from "../config";

interface SendOtpSmsInput {
  phoneNumber: string;
  code: string;
  clientReferenceId: string;
}

const GHASEDAK_OTP_URL =
  "https://gateway.ghasedak.me/rest/api/v1/WebService/SendOtpSMS";

export const sendOtpSms = async ({
  phoneNumber,
  code,
  clientReferenceId,
}: SendOtpSmsInput): Promise<void> => {
  if (config.otp.smsProvider === "none") return;

  if (config.otp.smsProvider === "ghasedak") {
    if (!config.otp.ghasedakApiKey) {
      const error = new Error(
        "SMS provider configured but AUTH_OTP_SMS_GHASEDAK_API_KEY is missing",
      );
      (error as Error & { statusCode: number }).statusCode = 500;
      throw error;
    }

    const response = await fetch(GHASEDAK_OTP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ApiKey: config.otp.ghasedakApiKey,
      },
      body: JSON.stringify({
        date: 0,
        receptors: [
          {
            mobile: phoneNumber,
            clientReferenceId,
          },
        ],
        inputs: [
          {
            param: "Code",
            value: code,
          },
        ],
        templateName: config.otp.ghasedakTemplateName,
        isVoice: config.otp.ghasedakIsVoice,
        udh: config.otp.ghasedakUdh,
      }),
    });

    if (!response.ok) {
      const payload = await response.text();
      const error = new Error(
        `OTP SMS send failed (${response.status}): ${payload || "no response body"}`,
      );
      (error as Error & { statusCode: number }).statusCode = 502;
      throw error;
    }

    return;
  }

  const error = new Error("Unsupported SMS provider");
  (error as Error & { statusCode: number }).statusCode = 500;
  throw error;
};
