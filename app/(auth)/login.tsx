import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView, Alert
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/src/hooks/useAuth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { signIn } = useAuth();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('오류', '이메일과 비밀번호를 입력해주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await signIn(email, password);
      if (error) throw error;
      router.replace('/(tabs)');
    } catch (error: any) {
      Alert.alert('로그인 실패', error.message || '알 수 없는 오류가 발생했습니다.');
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
            Easy Stock Portfolio
          </Text>
          <Text style={{ fontSize: 14, color: '#71717a' }}>
            계정에 로그인하세요
          </Text>
        </View>

        <View style={{ marginBottom: 16 }}>
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

        <View style={{ marginBottom: 24 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#a1a1aa', marginBottom: 6 }}>비밀번호</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor="#52525b"
            style={{
              backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a',
              borderRadius: 12, padding: 14, fontSize: 16, color: '#f4f4f5'
            }}
          />
        </View>

        <TouchableOpacity
          onPress={() => router.push('/(auth)/forgot-password')}
          style={{ alignSelf: 'flex-end', marginBottom: 24 }}
        >
          <Text style={{ fontSize: 13, color: '#22c55e' }}>비밀번호를 잊으셨나요?</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleLogin}
          disabled={isLoading}
          style={{
            backgroundColor: '#22c55e', borderRadius: 12, padding: 16,
            alignItems: 'center', opacity: isLoading ? 0.6 : 1
          }}
        >
          <Text style={{ color: '#052e16', fontWeight: '700', fontSize: 16 }}>
            {isLoading ? '로그인 중...' : '로그인'}
          </Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 24 }}>
          <Text style={{ fontSize: 14, color: '#71717a' }}>계정이 없으신가요? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/sign-up')}>
            <Text style={{ fontSize: 14, color: '#22c55e', fontWeight: '600' }}>회원가입</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
