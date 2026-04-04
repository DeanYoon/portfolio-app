import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView, Alert
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/src/hooks/useAuth';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { signUp } = useAuth();

  const handleSignUp = async () => {
    if (!email || !password) {
      Alert.alert('오류', '이메일과 비밀번호를 입력해주세요.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('오류', '비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await signUp(email, password);
      if (error) throw error;
      Alert.alert(
        '회원가입 완료',
        '확인 이메일이 발송되었습니다. 이메일을 확인해주세요.',
        [{ text: '확인', onPress: () => router.replace('/(auth)/login') }]
      );
    } catch (error: any) {
      Alert.alert('회원가입 실패', error.message || '알 수 없는 오류가 발생했습니다.');
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
            계정 만들기
          </Text>
          <Text style={{ fontSize: 14, color: '#71717a' }}>
            이메일로 회원가입하세요
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
            placeholder="최소 6자"
            placeholderTextColor="#52525b"
            style={{
              backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a',
              borderRadius: 12, padding: 14, fontSize: 16, color: '#f4f4f5'
            }}
          />
        </View>

        <TouchableOpacity
          onPress={handleSignUp}
          disabled={isLoading}
          style={{
            backgroundColor: '#22c55e', borderRadius: 12, padding: 16,
            alignItems: 'center', opacity: isLoading ? 0.6 : 1
          }}
        >
          <Text style={{ color: '#052e16', fontWeight: '700', fontSize: 16 }}>
            {isLoading ? '가입 처리 중...' : '회원가입'}
          </Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 24 }}>
          <Text style={{ fontSize: 14, color: '#71717a' }}>이미 계정이 있으신가요? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
            <Text style={{ fontSize: 14, color: '#22c55e', fontWeight: '600' }}>로그인</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
