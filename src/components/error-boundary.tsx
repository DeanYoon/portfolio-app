import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AlertTriangle, RefreshCw } from 'lucide-react-native';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name || 'Global'}]`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <View style={styles.container}>
          <AlertTriangle size={32} color="#ef4444" />
          <Text style={styles.title}>{this.props.name || '섹션'} 로딩 오류</Text>
          <Text style={styles.message}>{this.state.error?.message || '알 수 없는 문제가 발생했습니다.'}</Text>
          <TouchableOpacity style={styles.button} onPress={this.handleReset}>
            <RefreshCw size={16} color="#052e16" />
            <Text style={styles.buttonText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    backgroundColor: '#18181b',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#27272a',
    marginVertical: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#f4f4f5',
    marginTop: 12,
  },
  message: {
    fontSize: 12,
    color: '#71717a',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#22c55e',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#052e16',
  },
});
