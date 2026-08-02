import React from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { TransfersStackParamList } from '../../navigation/types';
import { TransferRequestDetail } from './TransferRequestDetail';
import { TransferProgressDetail } from './TransferProgressDetail';

type Navigation = NativeStackNavigationProp<TransfersStackParamList, 'TransferDetail'>;
type Route = RouteProp<TransfersStackParamList, 'TransferDetail'>;

/** Thin dispatcher on the route param's discriminant — see TransferDetailParams. */
export function TransferDetailScreen() {
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();

  if (params.kind === 'request') {
    return <TransferRequestDetail requestId={params.requestId} navigation={navigation} />;
  }
  return <TransferProgressDetail transferId={params.transferId} />;
}
