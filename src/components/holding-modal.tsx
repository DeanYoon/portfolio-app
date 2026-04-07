import { View, Text, Modal, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';
import { X, Trash2 } from 'lucide-react-native';

interface HoldingModalProps {
  visible: boolean;
  onClose: () => void;
  portfolioId: string;
  holdingId?: string;
  initialData?: {
    ticker: string;
    name?: string;
    quantity: number;
    avg_price: number;
    currency: string;
    country: string;
  };
  onSuccess: () => void;
}

const CURRENCIES = [
  { label: '🇰🇷 KRW', value: 'KRW', country: 'KR' },
  { label: '🇺🇸 USD', value: 'USD', country: 'US' },
  { label: '🇯🇵 JPY', value: 'JPY', country: 'JP' },
];

export default function HoldingModal({ visible, onClose, portfolioId, holdingId, initialData, onSuccess }: HoldingModalProps) {
  const isEdit = !!holdingId;
  
  const [ticker, setTicker] = useState(initialData?.ticker || '');
  const [quantity, setQuantity] = useState(initialData?.quantity?.toString() || '');
  const [avgPrice, setAvgPrice] = useState(initialData?.avg_price?.toString() || '');
  const [currency, setCurrency] = useState(initialData?.currency || 'USD');
  const [country, setCountry] = useState(initialData?.country || 'US');
  const [isCash, setIsCash] = useState(initialData?.ticker?.startsWith('CASH_') || false);
  const [stockName, setStockName] = useState(initialData?.name || '');
  
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Reset form when initialData changes
  useEffect(() => {
    if (initialData) {
      setTicker(initialData.ticker || '');
      setQuantity(initialData.quantity?.toString() || '');
      setAvgPrice(initialData.avg_price?.toString() || '');
      setCurrency(initialData.currency || 'USD');
      setCountry(initialData.country || 'US');
      setStockName(initialData.name || '');
      setIsCash(initialData.ticker?.startsWith('CASH_') || false);
    }
  }, [initialData, visible]);

  const handleCurrencySelect = useCallback((cur: string, ctr: string) => {
    setCurrency(cur);
    setCountry(ctr);
    if (isCash) {
      // Cash ticker will be set on submit
    }
  }, [isCash]);

  const handleSubmit = useCallback(async () => {
    setLoading(true);
    try {
      const qty = parseFloat(quantity);
      const avg = isCash ? 1 : parseFloat(avgPrice);
      
      if (isNaN(qty) || qty <= 0) {
        Alert.alert('오류', '수량을 입력하세요.');
        setLoading(false);
        return;
      }
      
      if (!isCash && (isNaN(avg) || avg <= 0)) {
        Alert.alert('오류', '평균단가를 입력하세요.');
        setLoading(false);
        return;
      }

      if (isEdit) {
        // Update existing
        const { error } = await supabase
          .from('holdings')
          .update({ quantity: qty, avg_price: avg })
          .eq('id', holdingId);
        if (error) throw error;
      } else {
        // Insert new
        const finalTicker = isCash ? `CASH_${currency}` : ticker.toUpperCase();
        const { error } = await supabase
          .from('holdings')
          .insert({
            portfolio_id: portfolioId,
            ticker: finalTicker,
            name: stockName || finalTicker,
            quantity: qty,
            avg_price: avg,
            currency,
            country,
          });
        if (error) throw error;
      }

      onClose();
      onSuccess();
    } catch (e: any) {
      console.error('Error saving holding:', e);
      Alert.alert('오류', '저장 중 오류가 발생했습니다.');
    }
    setLoading(false);
  }, [ticker, quantity, avgPrice, currency, country, stockName, isCash, isEdit, holdingId, portfolioId, onClose, onSuccess]);

  const handleDelete = useCallback(async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('holdings')
        .delete()
        .eq('id', holdingId);
      if (error) throw error;
      setShowDeleteConfirm(false);
      onClose();
      onSuccess();
    } catch (e: any) {
      console.error('Error deleting holding:', e);
      Alert.alert('오류', '삭제 중 오류가 발생했습니다.');
    }
    setLoading(false);
  }, [holdingId, onClose, onSuccess]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={onClose}>
        <View style={{ backgroundColor: '#18181b', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' }} onStartShouldSetResponder={() => true}>
          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#27272a' }}>
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#f4f4f5' }}>{isEdit ? '포지션 수정' : '종목 추가'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}><X size={24} color="#71717a" /></TouchableOpacity>
          </View>

          <ScrollView style={{ padding: 20, maxHeight: 600 }} keyboardShouldPersistTaps="handled">
            {/* Cash toggle */}
            <TouchableOpacity onPress={() => setIsCash(!isCash)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: isCash ? '#22c55e' : '#3f3f46', justifyContent: 'center', alignItems: 'center' }}>
                {isCash && <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: '#22c55e' }} />}
              </View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: isCash ? '#e4e4e7' : '#52525b' }}>현금 자산으로 추가</Text>
            </TouchableOpacity>

            {/* Ticker input (only for new, non-cash) */}
            {!isCash && !isEdit && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 6 }}>티커</Text>
                <TextInput
                  value={ticker}
                  onChangeText={(t) => { setTicker(t); if (stockName === '') setStockName(t); }}
                  placeholder="예: AAPL, 005930.KS"
                  placeholderTextColor="#52525b"
                  style={{ backgroundColor: '#27272a', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#f4f4f5', fontSize: 14, fontWeight: '700' }}
                  autoCapitalize="characters"
                />
              </View>
            )}

            {/* Ticker display (edit mode) */}
            {!isCash && isEdit && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 6 }}>티커</Text>
                <Text style={{ fontSize: 16, fontWeight: '900', color: '#f4f4f5' }}>{ticker}</Text>
              </View>
            )}

            {/* Stock name (new only) */}
            {!isCash && !isEdit && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 6 }}>종목명 (선택)</Text>
                <TextInput
                  value={stockName}
                  onChangeText={setStockName}
                  placeholder="자동 설정됨"
                  placeholderTextColor="#52525b"
                  style={{ backgroundColor: '#27272a', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#f4f4f5', fontSize: 14, fontWeight: '700' }}
                />
              </View>
            )}

            {/* Currency selector */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 6 }}>통화 / 국가</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {CURRENCIES.map(c => (
                  <TouchableOpacity
                    key={c.value}
                    onPress={() => handleCurrencySelect(c.value, c.country)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center',
                      backgroundColor: currency === c.value ? '#22c55e' : '#27272a',
                      borderColor: currency === c.value ? '#22c55e' : '#3f3f46',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '800', color: currency === c.value ? '#052e16' : '#71717a' }}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Quantity */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 6 }}>수량</Text>
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                placeholder="0"
                placeholderTextColor="#52525b"
                keyboardType="decimal-pad"
                style={{ backgroundColor: '#27272a', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#f4f4f5', fontSize: 16, fontWeight: '700' }}
              />
            </View>

            {/* Avg Price (not for cash) */}
            {!isCash && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: '#52525b', letterSpacing: 1, marginBottom: 6 }}>평균단가</Text>
                <TextInput
                  value={avgPrice}
                  onChangeText={setAvgPrice}
                  placeholder="0"
                  placeholderTextColor="#52525b"
                  keyboardType="decimal-pad"
                  style={{ backgroundColor: '#27272a', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#f4f4f5', fontSize: 16, fontWeight: '700' }}
                />
              </View>
            )}

            {/* Submit button */}
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={loading}
              style={{ backgroundColor: '#22c55e', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8, opacity: loading ? 0.5 : 1 }}
            >
              {loading ? (
                <ActivityIndicator color="#052e16" />
              ) : (
                <Text style={{ fontSize: 14, fontWeight: '900', color: '#052e16' }}>{isEdit ? '수정' : '추가'}</Text>
              )}
            </TouchableOpacity>

            {/* Delete button (edit mode) */}
            {isEdit && (
              <TouchableOpacity
                onPress={() => setShowDeleteConfirm(true)}
                disabled={loading}
                style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
              >
                <Trash2 size={16} color="#ef4444" />
                <Text style={{ fontSize: 14, fontWeight: '900', color: '#ef4444' }}>삭제</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>

        {/* Delete confirmation modal */}
        <Modal visible={showDeleteConfirm} transparent animationType="fade">
          <TouchableOpacity style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)' }} activeOpacity={1} onPress={() => setShowDeleteConfirm(false)}>
            <View style={{ backgroundColor: '#18181b', borderRadius: 24, padding: 24, width: '80%', maxWidth: 320 }} onStartShouldSetResponder={() => true}>
              <Text style={{ fontSize: 18, fontWeight: '900', color: '#f4f4f5', textAlign: 'center', marginBottom: 8 }}>삭제 확인</Text>
              <Text style={{ fontSize: 13, color: '#71717a', textAlign: 'center', marginBottom: 20 }}>{ticker} 자산이 완전히 삭제됩니다.</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity onPress={() => setShowDeleteConfirm(false)} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#27272a', alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: '#e4e4e7' }}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDelete} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#ef4444', alignItems: 'center' }}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 14, fontWeight: '800', color: '#fff' }}>삭제</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      </TouchableOpacity>
    </Modal>
  );
}
