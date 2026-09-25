/** The base of every error tsuzuri raises on purpose, so a consumer can catch them all with one check. */
export class TsuzuriError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A value given to tsuzuri that it cannot use, such as a date that is not a calendar date. */
export class InputError extends TsuzuriError {}

/** A `tsuzuri.toml`, or a file it names, that cannot be read or does not fit the settings' shape. */
export class ConfigError extends TsuzuriError {}
