import React from 'react';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { TransfersStackParamList } from '../../navigation/types';
import { TransferProgressDetail } from './TransferProgressDetail';

type Route = RouteProp<TransfersStackParamList, 'TransferDetail'>;

/** Thin wrapper reading the route param for TransferProgressDetail. */
export function TransferDetailScreen() {
  const { params } = useRoute<Route>();

  return <TransferProgressDetail transferId={params.transferId} />;
}
