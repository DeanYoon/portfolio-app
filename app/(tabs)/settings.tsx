import { View, Text, TouchableOpacity, ScrollView, Switch, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/src/hooks/useAuth';
import { supabase } from '@/src/lib/supabase';
import { LogOut, User, Shield, Bell, Moon } from 'lucide-react-native';
import { useState, useEffect } from 'react';

export default function SettingsScreen() {
  const { session, signOut } = useAuth();
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (session?.user?.email) setEmail(session.user.email);
  }, [session]);

  const handleSignOut = async () => {
    Alert.alert('로그아웃', '정말 로그아웃하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: async () => {
          const { error } = await signOut();
          if (!error) router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleDeleteAccount = async () => {
    Alert.alert('⚠️ 계정 삭제', '정말 계정을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          // TODO: 실제 계정 삭제 구현
          Alert.alert('문의', '계정 삭제는 데스크톱 버전에서 지원됩니다.');
        },
      },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#09090b' }} contentContainerStyle={{ padding: 16 }}>
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
        <TouchableOpacity style={{ padding: 16 }} onPress={handleDeleteAccount}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#ef4444', flex: 1 }}>계정 삭제</Text>
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
