import { Tabs, router } from 'expo-router';
import { LayoutGrid, Settings, TrendingUp, PieChart } from 'lucide-react-native';
import { useAuth } from '@/src/hooks/useAuth';
import { useEffect } from 'react';

export default function TabLayout() {
  const { session, loading } = useAuth();
  
  useEffect(() => {
    if (!session && !loading) {
      router.replace('/(auth)/login');
    }
  }, [session, loading]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#22c55e',
        tabBarInactiveTintColor: '#52525b',
        tabBarStyle: {
          backgroundColor: '#09090b',
          borderTopColor: '#27272a',
          borderTopWidth: 1,
          height: 70,
          paddingBottom: 10,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '대시보드',
          tabBarIcon: ({ color, size }) => <LayoutGrid size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="trends"
        options={{
          title: '추이',
          tabBarIcon: ({ color, size }) => <TrendingUp size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="dividends"
        options={{
          title: '배당',
          tabBarIcon: ({ color, size }) => <PieChart size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '설정',
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
