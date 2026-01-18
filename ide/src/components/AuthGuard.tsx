import { useEffect } from "react";
import { useSessionToken } from "../lib/client/session";

type AuthGuardProps = {
  children: React.ReactNode;
};

export const AuthGuard = ({ children }: AuthGuardProps) => {
  const { token, ready } = useSessionToken();

  // if (!ready) {
  //   // Optionally return a loading spinner here
  //   return null;
  // }

  // if (!token) {
  //   return null;
  // }

  return <>{children}</>;
};
