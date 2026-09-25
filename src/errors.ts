/** The base of every error neiro raises on purpose, so a consumer can catch them all with one check. */
export class NeiroError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A value given to neiro that it cannot use, such as a date that is not a calendar date. */
export class InputError extends NeiroError {}

/** A `neiro.toml`, or a file it names, that cannot be read or does not fit the settings' shape. */
export class ConfigError extends NeiroError {}
