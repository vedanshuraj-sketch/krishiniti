import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function FarmerDashboard() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerSmall}>नमस्कार, किसान 👋</Text>
        <Text style={styles.headerTitle}>Farmer Dashboard</Text>
        <Text style={styles.headerSubtitle}>
          Your market decision for today
        </Text>
        <View style={styles.contextRow}>
        <Text style={styles.contextText}>Tomato • 25 quintals</Text>
        <Text style={styles.contextText}>Ahmedabad • Today</Text>
      </View>
      </View>
      

      <View style={styles.cards}>
        {/* Today's Price */}
        <View style={styles.card}>
          <Text style={styles.label}>Today&apos;s Market Price</Text>

          <View style={styles.priceRow}>
            <Text style={styles.price}>₹2,600</Text>
            <Text style={styles.unit}>/ quintal</Text>
          </View>

          <View style={styles.trendRow}>
            <View style={styles.greenDot} />
            <Text style={styles.trend}>Price likely to increase</Text>
          </View>
        </View>

        {/* Recommendation */}
<View style={styles.recommendation}>
  <View style={styles.recommendationTop}>
    <View>
      <Text style={styles.recommendationLabel}>TODAY&apos;S ADVICE</Text>
      <Text style={styles.recommendationHint}>
        Best option for your crop
      </Text>
    </View>

    <View style={styles.storeBadge}>
      <Text style={styles.storeText}>STORE</Text>
    </View>
  </View>

  <Text style={styles.recommendationTitle}>
    STORE FOR 5 DAYS
  </Text>

  <Text style={styles.description}>
    You may get a better price if you wait before selling.
  </Text>

  <View style={styles.adviceBox}>
    <Text style={styles.adviceTitle}>
      Expected benefit
    </Text>

    <Text style={styles.adviceText}>
      Price may rise to ₹2,750–₹2,900 per quintal
    </Text>
  </View>
</View>

        {/* Expected Price */}
        <View style={styles.card}>
          <Text style={styles.label}>Expected Price After 5 Days</Text>

          <Text style={styles.expectedPrice}>₹2,750–₹2,900</Text>

          <Text style={styles.unitText}>per quintal</Text>

          <View style={styles.progressBackground}>
            <View style={styles.progress} />
          </View>
        </View>

        {/* Risk + Realisation */}
        <View style={styles.row}>
          <View style={[styles.card, styles.halfCard]}>
            <Text style={styles.label}>Risk</Text>

            <Text style={styles.risk}>Medium Risk</Text>

            <Text style={styles.smallText}>Price can change</Text>
          </View>

          <View style={[styles.card, styles.halfCard]}>
            <Text style={styles.label}>You may receive</Text>

            <Text style={styles.realisation}>₹68,500 –    ₹72,250</Text>

            <Text style={styles.smallText}>Estimated amount after costs</Text>
          </View>
        </View>

        {/* Why */}
        <View style={styles.card}>
         <Text style={styles.sectionTitle}>Why should you store?</Text>

          <View style={styles.reasons}>
            <Text style={styles.reason}>• Price may increase</Text>
            <Text style={styles.reason}>• Storage is available</Text>
            <Text style={styles.reason}>• Better market price expected</Text>
          </View>
        </View>

        {/* CTA */}
        <TouchableOpacity
  style={styles.button}
  activeOpacity={0.8}
  onPress={() => alert("Storage plan: Store for 5 days")}
>
  <Text style={styles.buttonText}>View Storage Plan</Text>
</TouchableOpacity>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },

  content: {
    paddingBottom: 32,
  },

  header: {
    backgroundColor: "#15803d",
    paddingTop: 55,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },

  headerSmall: {
    color: "#dcfce7",
    fontSize: 14,
    fontWeight: "600",
  },

  headerTitle: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "800",
    marginTop: 4,
  },

  headerSubtitle: {
    color: "#dcfce7",
    fontSize: 14,
    marginTop: 4,
  },
contextRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  marginTop: 16,
},

contextText: {
  color: "#ffffff",
  fontSize: 12,
  fontWeight: "600",
},

decisionSubtext: {
  color: "#15803d",
  fontSize: 14,
  fontWeight: "700",
  marginTop: 4,
},
  cards: {
    padding: 16,
    gap: 16,
  },

  card: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 20,
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  label: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: "600",
  },

  priceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 6,
  },

  price: {
    color: "#0f172a",
    fontSize: 38,
    fontWeight: "800",
  },

  unit: {
    color: "#64748b",
    fontSize: 14,
    marginLeft: 8,
    marginBottom: 5,
  },

  trendRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
  },

  greenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22c55e",
  },

  trend: {
    color: "#15803d",
    fontSize: 14,
    fontWeight: "700",
    marginLeft: 8,
  },

  recommendation: {
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: 18,
    padding: 20,
  },

  recommendationTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  recommendationLabel: {
    color: "#15803d",
    fontSize: 13,
    fontWeight: "800",
  },

  recommendationHint: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 3,
  },

  storeBadge: {
    backgroundColor: "#15803d",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
  },

  storeText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },

  recommendationTitle: {
    color: "#0f172a",
    fontSize: 25,
    fontWeight: "800",
    marginTop: 18,
  },

  description: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },

  adviceBox: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },

  adviceTitle: {
    color: "#15803d",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },

  adviceText: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    marginTop: 5,
  },

  expectedPrice: {
    color: "#0f172a",
    fontSize: 32,
    fontWeight: "800",
    marginTop: 6,
  },

  unitText: {
    color: "#64748b",
    fontSize: 14,
    marginTop: 2,
  },

  progressBackground: {
    height: 10,
    backgroundColor: "#e2e8f0",
    borderRadius: 10,
    marginTop: 16,
    overflow: "hidden",
  },

  progress: {
    width: "75%",
    height: "100%",
    backgroundColor: "#16a34a",
    borderRadius: 10,
  },

  row: {
    flexDirection: "row",
    gap: 12,
  },

  halfCard: {
    flex: 1,
  },

  risk: {
    color: "#d97706",
    fontSize: 23,
    fontWeight: "800",
    marginTop: 7,
  },

  realisation: {
    color: "#0f172a",
    fontSize: 19,
    fontWeight: "800",
    marginTop: 7,
  },

  smallText: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 5,
  },

  sectionTitle: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "800",
  },

  reasons: {
    marginTop: 14,
    gap: 10,
  },

  reason: {
    color: "#334155",
    fontSize: 14,
    lineHeight: 20,
  },

  button: {
    backgroundColor: "#15803d",
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: "center",
  },

  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
});