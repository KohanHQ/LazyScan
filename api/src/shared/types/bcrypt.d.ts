declare module "bcrypt" {
  export function genSalt(rounds?: number): Promise<string>;
  export function genSaltSync(rounds?: number): string;

  export function hash(
    data: string,
    saltOrRounds: string | number,
  ): Promise<string>;
  export function hashSync(data: string, saltOrRounds: string | number): string;

  export function compare(data: string, encrypted: string): Promise<boolean>;
  export function compareSync(data: string, encrypted: string): boolean;

  const bcrypt: {
    genSalt: typeof genSalt;
    genSaltSync: typeof genSaltSync;
    hash: typeof hash;
    hashSync: typeof hashSync;
    compare: typeof compare;
    compareSync: typeof compareSync;
  };

  export default bcrypt;
}
