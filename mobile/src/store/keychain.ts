import * as Keychain from 'react-native-keychain';

const KEYCHAIN_SERVICE = 'com.modulus.todo.auth';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export const saveTokens = async (tokens: AuthTokens): Promise<void> => {
  await Keychain.setGenericPassword('tokens', JSON.stringify(tokens), {
    service: KEYCHAIN_SERVICE,
  });
};

export const getTokens = async (): Promise<AuthTokens | null> => {
  try {
    const result = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (!result || !result.password) {
      return null;
    }
    const parsed = JSON.parse(result.password) as AuthTokens;
    if (parsed.accessToken && parsed.refreshToken) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

export const clearTokens = async (): Promise<void> => {
  try {
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  } catch {
    // Ignore reset errors
  }
};
