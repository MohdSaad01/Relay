import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Stand-in body for a screen whose feature milestone hasn't landed yet.
 * Replaced with real content as each feature in the incremental plan is built.
 */
export function PlaceholderScreen({ title }: { title: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>Not yet implemented.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  subtitle: {
    marginTop: 8,
    color: '#666',
  },
});
