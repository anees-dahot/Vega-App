/** How a provider's settings are keyed in the provider key-value storage. */
export const getScopedKvKey = (providerValue: string, key: string): string => {
  return `${providerValue}:${key}`;
};

export const getProviderKvPrefix = (providerValue: string): string => {
  return `${providerValue}:`;
};
