import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView, Alert
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/src/hooks/useAuth';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { resetPassword } = useAuth();

  const handleReset = async () => {
    if (!email) {
      Alert.alert('오류', '이메일을 입력해주세요.');
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await resetPassword(email);
      if (error) throw error;
      Alert.alert('성공', '비밀번호 재설정 이메일이 발송되었습니다.');
      router.replace('/(auth)/login');
    } catch (error: any) {
      Alert.alert('오류', error.message || '알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: '#09090b' }}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
        <View style={{ marginBottom: 32 }}>
          <Text style={{ fontSize: 28, fontWeight: '900', color: '#f4f4f5', marginBottom: 8 }}>
            비밀번호 재설정
          </Text>
          <Text style={{ fontSize: 14, color: '#71717a' }}>
            가입한 이메일을 입력하면 재설정 링크를 보내드립니다.
          </Text>
        </View>

        <View style={{ marginBottom: 24 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#a1a1aa', marginBottom: 6 }}>이메일</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="m@example.com"
            placeholderTextColor="#52525b"
            style={{
              backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a',
              borderRadius: 12, padding: 14, fontSize: 16, color: '#f4f4f5'
            }}
          />
        </View>

        <TouchableOpacity
          onPress={handleReset}
          disabled={isLoading}
          style={{
            backgroundColor: '#22c55e', borderRadius: 12, padding: 16,
            alignItems: 'center', opacity: isLoading ? 0.6 : 1
          }}
        >
          <Text style={{ color: '#052e16', fontWeight: '700', fontSize: 16 }}>
            {isLoading ? '전송 중...' : '재설정 링크 보내기'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginTop: 24, alignItems: 'center' }}
        >
          <Text style={{ fontSize: 14, color: '#71717a' }}>← 로그인으로 돌아가기</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
