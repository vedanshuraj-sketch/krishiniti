import React from 'react';
import
  {
    Alert,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    View,
  } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type CropLot = {
  id: string;
  crop: string;
  emoji: string;
  quantity: string;
  grade: string;
  location: string;
  price: string;
  available: string;
};

const cropLots: CropLot[] = [
  {
    id: '1',
    crop: 'Tomato',
    emoji: '🍅',
    quantity: '25 quintals',
    grade: 'Grade A',
    location: 'Ahmedabad',
    price: '₹2,720',
    available: 'Available today',
  },
  {
    id: '2',
    crop: 'Potato',
    emoji: '🥔',
    quantity: '40 quintals',
    grade: 'Grade A',
    location: 'Mehsana',
    price: '₹1,950',
    available: 'Available today',
  },
  {
    id: '3',
    crop: 'Onion',
    emoji: '🧅',
    quantity: '30 quintals',
    grade: 'Grade B',
    location: 'Rajkot',
    price: '₹2,350',
    available: 'Available tomorrow',
  },
];

export default function ExploreScreen()
{
  const handleViewLot = (lot: CropLot) =>
  {
    Alert.alert(
      `${lot.emoji} ${lot.crop} — Crop Lot`,
      `Quantity: ${lot.quantity}\nQuality: ${lot.grade}\nLocation: ${lot.location}\nExpected price: ${lot.price} / quintal\nAvailability: ${lot.available}`,
      [
        {
          text: 'Contact Farmer',
          onPress: () =>
            Alert.alert(
              'Interest Sent',
              `Your interest in the ${lot.crop} lot has been recorded.`,
            ),
        },
        {
          text: 'Close',
          style: 'cancel',
        },
      ],
    );
  };

  const renderLot = ({ item }: { item: CropLot }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cropIcon}>
          <Text style={styles.cropEmoji}>{item.emoji}</Text>
        </View>

        <View style={styles.cropInfo}>
          <Text style={styles.cropName}>{item.crop}</Text>
          <Text style={styles.location}>{item.location}</Text>
        </View>

        <View style={styles.priceBox}>
          <Text style={styles.price}>{item.price}</Text>
          <Text style={styles.priceUnit}>/ quintal</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.detailsRow}>
        <View>
          <Text style={styles.detailLabel}>QUANTITY</Text>
          <Text style={styles.detailValue}>{item.quantity}</Text>
        </View>

        <View>
          <Text style={styles.detailLabel}>QUALITY</Text>
          <Text style={styles.detailValue}>{item.grade}</Text>
        </View>

        <View style={styles.availabilityBox}>
          <Text style={styles.available}>{item.available}</Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.viewButton,
          pressed && styles.buttonPressed,
        ]}
        onPress={() => handleViewLot(item)}
      >
        <Text style={styles.viewButtonText}>View crop lot</Text>
        <Text style={styles.arrow}>→</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={cropLots}
        keyExtractor={(item) => item.id}
        renderItem={renderLot}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.eyebrow}>BUYER MARKET</Text>
            <Text style={styles.title}>Find fresh crop lots</Text>
            <Text style={styles.subtitle}>
              Connect with farmers and source crops directly.
            </Text>

            <View style={styles.summary}>
              <Text style={styles.summaryNumber}>{cropLots.length}</Text>
              <Text style={styles.summaryText}>active crop lots</Text>
            </View>

            <Text style={styles.sectionTitle}>Available lots</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F7F2',
  },

  container: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 32,
  },

  header: {
    marginBottom: 18,
  },

  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: '#66736A',
    marginBottom: 8,
  },

  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#172019',
  },

  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#66736A',
    marginTop: 7,
    maxWidth: 330,
  },

  summary: {
    marginTop: 18,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#EAF1E7',
    flexDirection: 'row',
    alignItems: 'baseline',
  },

  summaryNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: '#315B38',
    marginRight: 7,
  },

  summaryText: {
    fontSize: 13,
    color: '#526356',
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#172019',
    marginTop: 24,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E1E7DF',
  },

  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  cropIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: '#EEF3EA',
    alignItems: 'center',
    justifyContent: 'center',
  },

  cropEmoji: {
    fontSize: 24,
  },

  cropInfo: {
    flex: 1,
    marginLeft: 12,
  },

  cropName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#172019',
  },

  location: {
    fontSize: 12,
    color: '#707B73',
    marginTop: 3,
  },

  priceBox: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },

  price: {
    fontSize: 17,
    fontWeight: '800',
    color: '#315B38',
  },

  priceUnit: {
    fontSize: 10,
    color: '#78837B',
    marginTop: 2,
  },

  divider: {
    height: 1,
    backgroundColor: '#E8ECE6',
    marginVertical: 15,
  },

  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  detailLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#8A938C',
    marginBottom: 4,
  },

  detailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#303A32',
  },

  availabilityBox: {
    flex: 1,
    alignItems: 'flex-end',
  },

  available: {
    fontSize: 10,
    color: '#5B735F',
    textAlign: 'right',
  },

  viewButton: {
    height: 44,
    borderRadius: 13,
    backgroundColor: '#315B38',
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  buttonPressed: {
    opacity: 0.8,
  },

  viewButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  arrow: {
    fontSize: 18,
    color: '#FFFFFF',
    marginLeft: 8,
    marginBottom: 8,
  },
});