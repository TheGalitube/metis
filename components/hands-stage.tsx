"use client";

import type { ComponentProps, ReactNode } from "react";
import { JarvisWordmark } from "@/components/jarvis-wordmark";
import { cn } from "@/lib/utils";

export function HandsStage({
  children,
  contentClassName,
  ...props
}: {
  children: ReactNode;
  contentClassName?: string;
} & ComponentProps<"main">) {
  return (
    <main
      {...props}
      className={cn(
        "jarvis-stage relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-12 text-foreground",
        props.className,
      )}
    >
      <div className="jarvis-stage-halo" aria-hidden="true" />
      <section className={cn("relative z-10 w-full max-w-xl", contentClassName)}>
        <div className="mb-10 flex justify-start"><JarvisWordmark /></div>
        {children}
      </section>
    </main>
  );
}
