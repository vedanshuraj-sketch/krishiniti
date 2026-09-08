import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
  <NativeTabs
  backgroundColor={colors.background}
  indicatorColor={colors.backgroundElement}
  labelVisibilityMode="labeled"
  labelStyle={{
    default: { color: colors.text },
    selected: { color: colors.text },
  }}
>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
       
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="market-intellegence">
        <NativeTabs.Trigger.Label>Market</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/market.png')}
          
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="crop-lot">
        <NativeTabs.Trigger.Label>Sell</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/sell.png')}
         
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>Buy</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/buy.png')}
                  />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}