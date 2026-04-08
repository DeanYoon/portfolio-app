import { View, Text, TouchableOpacity, ScrollView, Switch, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/src/hooks/useAuth';
import { supabase } from '@/src/lib/supabase';
import { LogOut, User, Shield, Bell, Moon } from 'lucide-react-native';
import { useState, useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { session, signOut, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (session?.user?.email) {
      setEmail(session.user.email);
    } else if (!session && !authLoading) {
      // Admin bypass identification
      // In a real app, you might check a flag set during login bypass
      setEmail('admin');
    }
  }, [session, authLoading]);

  const handleSignOut = async () => {
    console.log('[handleSignOut] 로그아웃 버튼 터치됨');
    
    // 모바일/웹 공통 동작 확인을 위해 기본 window.confirm을 사용할 수도 있으나
    // RN/Expo 환경에서는 Alert가 안전합니다.
    Alert.alert('로그아웃', '정말 로그아웃하시겠습니까?', [
      { 
        text: '취소', 
        style: 'cancel',
        onPress: () => console.log('[handleSignOut] 팝업에서 취소 터치')
      },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: async () => {
          console.log('[handleSignOut] 로그아웃 팝업 확인 버튼 눌림 - 진짜 시작');
          
          try {
            console.log('[handleSignOut] 1. session 확인 / UseAuth signOut 수행 시작');
            await signOut(); 
            console.log('[handleSignOut] 1. UseAuth signOut 끝');
          } catch(e) {
            console.error('[handleSignOut] 1. error', e);
          }
          
          console.log('[handleSignOut] 2. 로컬 스토리지 삭제 시도 (Web)');
          if (typeof window !== 'undefined' && window.localStorage) {
             window.localStorage.removeItem('adminBypass');
             window.localStorage.clear();
             console.log('[handleSignOut] 2. window.localStorage.clear() 호출됨');
             
             // 웹 환경에서 페이지 강제로 새로고침해버리기 (브라우저 데이터 완전 갱신용)
             if (window.location) {
                console.log('[handleSignOut] 웹 환경: router 로직으로 이동');
             }
          }
          
          console.log('[handleSignOut] 3. AsyncStorage 삭제 시도 (Native)');
          try {
            await AsyncStorage.removeItem('adminBypass');
            await AsyncStorage.clear();
            console.log('[handleSignOut] AsyncStorage.clear() 호출됨');
          } catch(e) { 
            console.error('[handleSignOut] 3. error', e);
          }
          
          console.log('[handleSignOut] 4. router.replace("/(auth)/login") 강제 이동');
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleDeleteAccount = async () => {
    // Admin restriction or general disable as requested
    Alert.alert('알림', '계정 삭제는 현재 보호된 기능입니다.');
  };

  return (
    <ScrollView 
      style={{ flex: 1, backgroundColor: '#09090b' }} 
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}
    >
      {/* 프로필 섹션 */}
      <View style={{ backgroundColor: '#18181b', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#27272a' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#22c55e', justifyContent: 'center', alignItems: 'center' }}>
            <User size={24} color="#052e16" />
          </View>
          <View>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#f4f4f5' }}>내 계정</Text>
            <Text style={{ fontSize: 13, color: '#71717a', marginTop: 2 }}>{email}</Text>
          </View>
        </View>
      </View>

      {/* 설정 옵션들 */}
      <View style={{ backgroundColor: '#18181b', borderRadius: 16, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: '#27272a' }}>
        <SettingRow icon={<Bell size={18} color="#a1a1aa" />} title="알림 설정" hasSwitch />
        <View style={{ height: 1, backgroundColor: '#27272a' }} />
        <SettingRow icon={<Moon size={18} color="#a1a1aa" />} title="다크 모드" hasSwitch defaultOn={true} />
        <View style={{ height: 1, backgroundColor: '#27272a' }} />
        <SettingRow icon={<Shield size={18} color="#a1a1aa" />} title="개인정보처리방침" onPress={() => {}} />
      </View>

      {/* 계정 관리 */}
      <View style={{ backgroundColor: '#18181b', borderRadius: 16, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: '#27272a' }}>
        <TouchableOpacity style={{ padding: 16 }} onPress={handleSignOut}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <LogOut size={18} color="#ef4444" />
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#ef4444', flex: 1 }}>로그아웃</Text>
          </View>
        </TouchableOpacity>
        <View style={{ height: 1, backgroundColor: '#27272a' }} />
        <TouchableOpacity style={{ padding: 16, opacity: 0.5 }} onPress={handleDeleteAccount} disabled={true}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#ef4444', flex: 1 }}>계정 삭제 (비활성화됨)</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* 앱 정보 */}
      <Text style={{ textAlign: 'center', fontSize: 12, color: '#52525b', marginTop: 24 }}>
        Easy Stock Portfolio v1.0.0
      </Text>
    </ScrollView>
  );
}

function SettingRow({
  icon, title, hasSwitch, defaultOn, onPress,
}: {
  icon: React.ReactNode;
  title: string;
  hasSwitch?: boolean;
  defaultOn?: boolean;
  onPress?: () => void;
}) {
  const [value, setValue] = useState(defaultOn ?? false);

  return (
    <TouchableOpacity
      style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!!hasSwitch}
    >
      {icon}
      <Text style={{ fontSize: 15, fontWeight: '500', color: '#e4e4e7', flex: 1 }}>{title}</Text>
      {hasSwitch && (
        <Switch
          value={value}
          onValueChange={setValue}
          trackColor={{ false: '#27272a', true: '#22c55e' }}
          thumbColor="#f4f4f5"
        />
      )}
    </TouchableOpacity>
  );
}
