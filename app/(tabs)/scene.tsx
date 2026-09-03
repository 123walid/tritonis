// Scene tab — placeholder (SPEC §3: "Scenes are coming in a later phase").
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import EmptyState from '../../src/components/EmptyState';
import Screen from '../../src/components/Screen';
import { t } from '../../src/i18n';
import { colors } from '../../src/theme';

export default function SceneScreen() {
  return (
    <Screen contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <EmptyState
        icon={<Ionicons name="grid-outline" size={64} color={colors.secondary} />}
        title={t('scene.title')}
        body={t('scene.placeholder')}
      />
    </Screen>
  );
}
