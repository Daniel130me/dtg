import { Suspense } from "react";
import { LoginPage } from "@/features/public-pages";

export default function LoginRoute() {
  return <Suspense fallback={null}><LoginPage /></Suspense>;
}
