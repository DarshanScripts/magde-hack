"use client";

import dynamic from "next/dynamic";

const SignCamera = dynamic(() => import("@/components/SignCamera"), { ssr: false });

export default function RecordPage() {
  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <SignCamera mode="infer" />
    </main>
  );
}
