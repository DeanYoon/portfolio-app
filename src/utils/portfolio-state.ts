import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'selected_portfolio_id';

export async function getSelectedPortfolioId(): Promise<string | null> {
  try { return await AsyncStorage.getItem(KEY); } catch { return null; }
}

export async function setSelectedPortfolioId(id: string | null) {
  try {
    if (id) await AsyncStorage.setItem(KEY, id);
    else await AsyncStorage.removeItem(KEY);
  } catch {}
}
