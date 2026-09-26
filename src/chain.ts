import { TsuzuriError } from "./errors.ts";

/** Raised when no provider, setting, or source can serve a request; the message names what is missing. */
export class UnsupportedError extends TsuzuriError {}

export interface Provider<T> {
  name: string;
  /** What the provider needs, for the error raised when no provider is available. */
  requires: string;
  available: () => boolean;
  impl: T;
}

/**
 * One capability's providers, in order of preference. The first available provider serves the call, and every
 * provider must return exactly what the portable one returns.
 */
export class Chain<T> {
  readonly capability: string;
  readonly providers: Provider<T>[];
  private forced?: string;

  constructor(capability: string, providers: Provider<T>[]) {
    this.capability = capability;
    this.providers = providers;
  }

  get(): T {
    const provider = this.forced
      ? this.providers.find((candidate) => candidate.name === this.forced)
      : this.providers.find((candidate) => candidate.available());
    if (!provider) {
      const needs = this.providers.map((candidate) => `${candidate.name} needs ${candidate.requires}`).join("; ");
      throw new UnsupportedError(`no provider can ${this.capability}: ${needs}`);
    }
    return provider.impl;
  }

  /** Serve every call from the named provider, or return to the first available one. For tests. */
  force(name?: string): void {
    if (name !== undefined && !this.providers.some((candidate) => candidate.name === name)) {
      throw new Error(`${this.capability} has no provider named ${name}`);
    }
    this.forced = name;
  }
}
