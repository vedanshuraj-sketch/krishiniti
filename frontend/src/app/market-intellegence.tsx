import React, { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
} from 'react-native';

const markets = [
  {
    name: 'Gondal Market',
    distance: '42 km',
    price: 2850,
    change: '+6.2%',
    difference: '+₹130 vs Ahmedabad',
    best: true,
  },
  {
    name: 'Ahmedabad APMC',
    distance: '18 km',
    price: 2720,
    change: '+3.4%',
    difference: 'Base price',
    best: false,
  },
  {
    name: 'Mehsana Market',
    distance: '72 km',
    price: 2680,
    change: '+1.8%',
    difference: '₹40 less',
    best: false,
  },
  {
    name: 'Rajkot Market',
    distance: '78 km',
    price: 2790,
    change: '+4.5%',
    difference: '+₹70 vs Ahmedabad',
    best: false,
  },
];

const trendData = [2480, 2520, 2580, 2630, 2680, 2760, 2850];

export default function MarketIntelligenceScreen() {
  const highestPrice = Math.max(...trendData);
  const lowestPrice = Math.min(...trendData);
  const [chartWidth, setChartWidth] = useState(0);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <View style={styles.headerText}>
            <Text style={styles.eyebrow}>MARKET INTELLIGENCE</Text>
            </View>
            <Text style={styles.title}>Where should you sell?</Text>
            <Text style={styles.subtitle}>
              Tomato • 25 quintals • Ahmedabad
            </Text>
          </View>

          <View style={styles.cropBadge}>
            <Text style={styles.cropEmoji}>🍅</Text>
          </View>
        </View>

{/* Best Market */}
<View style={styles.bestCard}>
  {/* Top */}
  <View style={styles.bestTopRow}>
    <View>
      <Text style={styles.bestLabel}>★  BEST PRICE NEARBY</Text>
      <Text style={styles.bestMarket}>Gondal Market</Text>
    </View>

    <View style={styles.bestBadge}>
      <Text style={styles.bestBadgeText}>BEST</Text>
    </View>
  </View>

  {/* Price + Today Change */}
  <View style={styles.priceMainRow}>
    <View style={styles.priceRow}>
      <Text style={styles.bestPrice}>₹2,850</Text>
      <Text style={styles.perQuintal}>/ quintal</Text>
    </View>

    <View style={styles.todayChangeBox}>
      <Text style={styles.todayChange}>↗ +6.2%</Text>
      <Text style={styles.todayLabel}>today</Text>
    </View>
  </View>

  {/* Details */}
<View style={styles.bestDetails}>
  <View style={styles.detailItem}>
    <Text style={styles.detailLabel}>Distance</Text>
    <Text style={styles.detailValue}>42 km</Text>
  </View>

  <View style={styles.detailItem}>
    <Text style={styles.detailLabel}>Transport (est.)</Text>
    <Text style={styles.detailValue}>~₹1,500</Text>
  </View>

  <View style={styles.detailItem}>
    <Text style={styles.detailLabel}>Net value (est.)</Text>
    <Text style={styles.netValue}>₹69,750</Text>
  </View>

  <View style={styles.detailItem}>
    <Text style={styles.detailLabel}>vs Ahmedabad</Text>
    <Text style={styles.netValue}>+₹130</Text>
  </View>
</View>

  {/* Why */}
<View style={styles.recommendationNote}>
  <View style={styles.whyIcon}>
    <View style={styles.whyCircle}>
      <Text style={styles.whyEmoji}>💡</Text>
    </View>
  </View>

  <View style={styles.whyContent}>
    <Text style={styles.recommendationTitle}>Why Gondal?</Text>

    <Text style={styles.recommendationText}>
      Highest nearby price with a positive 7-day trend.
      After estimated transport costs, it may still give you better returns.
    </Text>
  </View>
</View>

  {/* CTA */}
  <Pressable
    style={styles.primaryButton}
    onPress={() => {
      alert(
        'Best Selling Option\n\n' +
        'Gondal Market\n' +
        '₹2,850 / quintal\n\n' +
        '25 quintals × ₹2,850 = ₹71,250\n' +
        'Estimated transport = ₹1,500\n' +
        'Estimated net value = ₹69,750\n\n' +
        'Recommended: Gondal Market'
      );
    }}
  >
    <Text style={styles.primaryButtonText}>
      View best selling option
    </Text>
    <Text style={styles.arrow}>→</Text>
  </Pressable>
</View>

        {/* Market Comparison */}
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Nearby markets</Text>
            <Text style={styles.sectionSubtitle}>
              Compare today's tomato prices
            </Text>
          </View>
        </View>

       <View style={styles.marketList}>
  {markets.map((market, index) => (
    <Pressable
      key={market.name}
      style={[
        styles.marketRow,
        index === markets.length - 1 && styles.lastMarketRow,
      ]}
      onPress={() => {
        alert(
          `${market.name}\n\nPrice: ₹${market.price.toLocaleString(
            'en-IN'
          )} / quintal\nDistance: ${market.distance}\nToday's change: ${
            market.change
          }`
        );
      }}
    >
      <View style={styles.marketRank}>
        <Text style={styles.marketRankText}>{index + 1}</Text>
      </View>

      <View style={styles.marketInfo}>
        <Text style={styles.marketName}>{market.name}</Text>
        <Text style={styles.marketDistance}>
          {market.distance} away
        </Text>
      </View>

      <View style={styles.marketPriceBox}>
        <Text style={styles.marketPrice}>
          ₹{market.price.toLocaleString('en-IN')}
        </Text>
        <Text style={styles.marketChange}>{market.change}</Text>
        <Text style={styles.marketDifference}>{market.difference}</Text>
      </View>

      <Text style={styles.marketArrow}>›</Text>
    </Pressable>
  ))}
</View>

        {/* Trend */}
<View style={styles.trendCard}>
  <View style={styles.trendHeader}>
    <View>
      <Text style={styles.sectionTitle}>Price trend</Text>
      <Text style={styles.sectionSubtitle}>
        Last 7 days • Gondal Market
      </Text>
    </View>

    <View style={styles.trendChange}>
      <Text style={styles.trendChangeText}>↑ 14.9%</Text>
      <Text style={styles.trendChangeLabel}>7 days</Text>
    </View>
  </View>

  {/* Line Chart */}
{/* Line Chart */}
<View
  style={styles.chart}
  onLayout={(event) => {
    setChartWidth(event.nativeEvent.layout.width);
  }}
>
  {/* Connecting lines */}
  {trendData.slice(0, -1).map((price, index) => {
    if (!chartWidth) return null;

    const chartHeight = 110;
    const startX =
      (index / (trendData.length - 1)) * chartWidth;
    const endX =
      ((index + 1) / (trendData.length - 1)) * chartWidth;

    const startY =
      15 +
      (1 -
        (price - lowestPrice) /
          (highestPrice - lowestPrice)) *
        75;

    const endY =
      15 +
      (1 -
        (trendData[index + 1] - lowestPrice) /
          (highestPrice - lowestPrice)) *
        75;

    const dx = endX - startX;
    const dy = endY - startY;

    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    return (
      <View
        key={`line-${index}`}
        style={[
          styles.chartLine,
          {
            width: length,
            left: startX,
            top: startY,
            transform: [{ rotate: `${angle}deg` }],
          },
        ]}
      />
    );
  })}

  {/* Points */}
  {trendData.map((price, index) => {
    const position =
      15 +
      (1 -
        (price - lowestPrice) /
          (highestPrice - lowestPrice)) *
        75;

    return (
      <View
        key={`point-${index}`}
        style={[
          styles.chartPointContainer,
          {
            left:
              (index / (trendData.length - 1)) *
              chartWidth,
            top: position,
          },
        ]}
      >
        <View style={styles.chartPoint} />
      </View>
    );
  })}

  {/* Weekdays */}
  <View style={styles.daysRow}>
    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(
      (day, index) => (
        <Text key={`${day}-${index}`} style={styles.dayLabel}>
          {day}
        </Text>
      )
    )}
  </View>
</View>

  <View style={styles.trendBottom}>
    <View>
      <Text style={styles.trendBottomText}>7 days ago</Text>
      <Text style={styles.trendStartPrice}>₹2,480</Text>
    </View>

    <View style={styles.trendToday}>
      <Text style={styles.trendBottomText}>Today</Text>
      <Text style={styles.currentPriceText}>₹2,850</Text>
    </View>
  </View>
</View>

        {/* Insight */}
        <View style={styles.insightCard}>
          <View style={styles.insightIcon}>
            <Text style={styles.insightEmoji}>💡</Text>
          </View>

          <View style={styles.insightContent}>
            <Text style={styles.insightTitle}>Good time to compare</Text>
            <Text style={styles.insightText}>
              Gondal is currently offering ₹130 more per quintal than
              Ahmedabad. Prices have also been rising for the last 7 days.
            </Text>
          </View>
        </View>

        <Text style={styles.footerNote}>
          Prices shown are indicative market prices.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F8F4',
  },

  container: {
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 32,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
 headerText: {
  flex: 1,
  paddingRight: 10,
},
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#6B7567',
    marginBottom: 5,
  },

  title: {
    fontSize: 25,
    fontWeight: '800',
    color: '#182018',
  },

  subtitle: {
    marginTop: 5,
    fontSize: 13,
    color: '#6B7567',
  },

  cropBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E9F1E4',
    alignItems: 'center',
    justifyContent: 'center',
  },

  priceMainRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: 10,
},

todayChangeBox: {
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.2)',
  borderRadius: 14,
  paddingVertical: 10,
  paddingHorizontal: 14,
  alignItems: 'center',
},

todayChange: {
  color: '#D9F59A',
  fontSize: 18,
  fontWeight: '800',
},

todayLabel: {
  color: '#D8E2D9',
  fontSize: 12,
  marginTop: 2,
},

detailItem: {
  flex: 1,
},

netValue: {
  fontSize: 17,
  fontWeight: '800',
  color: '#D9F59A',
},

  cropEmoji: {
    fontSize: 25,
  },

  bestCard: {
    backgroundColor: '#254D32',
    borderRadius: 22,
    padding: 20,
    marginBottom: 26,
  },

 recommendationNote: {
  marginTop: 16,
  padding: 12,
  borderRadius: 16,
  backgroundColor: 'rgba(255,255,255,0.06)',
  borderWidth: 1,
  borderColor: 'rgba(217,245,154,0.18)',
  flexDirection: 'row',
  alignItems: 'center',
},

whyIcon: {
  width: 46,
  height: 46,
  borderRadius: 23,
  borderWidth: 1,
  borderColor: 'rgba(217,245,154,0.4)',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 12,
},

whyCircle: {
  width: 34,
  height: 34,
  borderRadius: 17,
  backgroundColor: 'rgba(217,245,154,0.14)',
  alignItems: 'center',
  justifyContent: 'center',
},

whyEmoji: {
  fontSize: 18,
},

whyContent: {
  flex: 1,
},

recommendationTitle: {
  fontSize: 14,
  fontWeight: '800',
  color: '#D9F59A',
  marginBottom: 4,
},

recommendationText: {
  fontSize: 11,
  lineHeight: 17,
  color: '#D8E2D9',
},
  bestTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  bestLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#BFD6C2',
    marginBottom: 5,
  },

  bestMarket: {
    fontSize: 21,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  bestBadge: {
    backgroundColor: '#DCECCF',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  bestBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#315B38',
  },

  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 16,
  },

  bestPrice: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  perQuintal: {
    fontSize: 13,
    color: '#C9D8CB',
    marginLeft: 5,
  },

 bestDetails: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  borderTopWidth: 1,
  borderBottomWidth: 1,
  borderColor: 'rgba(255,255,255,0.15)',
  paddingVertical: 16,
  marginTop: 18,
},

detailItem: {
  width: '50%',
  paddingVertical: 7,
},

detailLabel: {
  fontSize: 11,
  color: '#BFD6C2',
  marginBottom: 5,
},

detailValue: {
  fontSize: 15,
  fontWeight: '700',
  color: '#FFFFFF',
},

netValue: {
  fontSize: 15,
  fontWeight: '800',
  color: '#D9F59A',
},

  detailLabel: {
    fontSize: 10,
    color: '#BFD6C2',
    marginBottom: 4,
  },

  detailValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  positiveValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#D9F2C8',
  },

  primaryButton: {
    height: 46,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },

  primaryButtonText: {
    color: '#254D32',
    fontSize: 14,
    fontWeight: '800',
  },

  arrow: {
    color: '#254D32',
    fontSize: 20,
    marginLeft: 8,
  },

  sectionHeader: {
    marginBottom: 12,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1D261E',
  },

  sectionSubtitle: {
    marginTop: 3,
    fontSize: 12,
    color: '#737B70',
  },

  marketList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    marginBottom: 20,
    overflow: 'hidden',
  },

  marketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF0EB',
  },

  marketArrow: {
  fontSize: 24,
  color: '#7A857B',
  marginLeft: 6,
  width: 14,
  textAlign: 'center',
},

marketDifference: {
  fontSize: 10,
  color: '#6B756D',
  marginTop: 2,
  maxWidth: 105,
},

  lastMarketRow: {
    borderBottomWidth: 0,
  },

  marketRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F0F3ED',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },

  marketRankText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#687264',
  },

  marketInfo: {
    flex: 1,
  },

  marketName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#202820',
  },

  marketDistance: {
    fontSize: 11,
    color: '#858D82',
    marginTop: 3,
  },

  marketPriceBox: {
    width: 105,
    alignItems: 'flex-end',
  },

  marketPrice: {
    fontSize: 15,
    fontWeight: '800',
    color: '#202820',
  },

  marketChange: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3E7A47',
    marginTop: 3,
  },

 trendCard: {
  backgroundColor: '#FFFFFF',
  borderRadius: 18,
  padding: 18,
  marginBottom: 16,
  borderWidth: 1,
  borderColor: '#EEF1EB',
},

  trendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  trendChange: {
    backgroundColor: '#E8F2E5',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },

  trendChangeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#397143',
  },

 chart: {
  height: 150,
  marginTop: 20,
  position: 'relative',
},

chartPointContainer: {
  position: 'absolute',
  width: 10,
  height: 10,
  marginLeft: -5,
  marginTop: -5,
  zIndex: 3,
},

chartPoint: {
  width: 10,
  height: 10,
  borderRadius: 5,
  backgroundColor: '#FFFFFF',
  borderWidth: 3,
  borderColor: '#4D8A50',
},

chartLine: {
  position: 'absolute',
  height: 3,
  backgroundColor: '#4D8A50',
  transformOrigin: 'left center',
  zIndex: 1,
},

daysRow: {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  flexDirection: 'row',
  justifyContent: 'space-between',
},

dayLabel: {
  fontSize: 11,
  color: '#8A9186',
},

trendChange: {
  backgroundColor: '#E8F2E5',
  borderRadius: 12,
  paddingHorizontal: 10,
  paddingVertical: 7,
  alignItems: 'center',
},

trendChangeText: {
  fontSize: 13,
  fontWeight: '800',
  color: '#397143',
},

trendChangeLabel: {
  fontSize: 9,
  color: '#718071',
  marginTop: 1,
},

trendBottom: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'flex-end',
  marginTop: 6,
},

trendBottomText: {
  fontSize: 10,
  color: '#8A9186',
},

trendStartPrice: {
  fontSize: 13,
  fontWeight: '700',
  color: '#59645A',
  marginTop: 2,
},

trendToday: {
  alignItems: 'flex-end',
},

currentPriceText: {
  fontSize: 16,
  fontWeight: '800',
  color: '#254D32',
  marginTop: 2,
},

  dayLabel: {
    fontSize: 10,
    color: '#8A9186',
    marginTop: 7,
  },

  trendBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },

  trendBottomText: {
    fontSize: 11,
    color: '#8A9186',
  },

  currentPriceText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3F6543',
  },

  insightCard: {
    flexDirection: 'row',
    backgroundColor: '#FFF9E9',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F2E7C7',
  },

  insightIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFF0BE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  insightEmoji: {
    fontSize: 19,
  },

  insightContent: {
    flex: 1,
  },

  insightTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#4C4328',
    marginBottom: 4,
  },

  insightText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6D6242',
  },

  footerNote: {
    textAlign: 'center',
    fontSize: 10,
    color: '#9A9F96',
    marginTop: 4,
  },
});