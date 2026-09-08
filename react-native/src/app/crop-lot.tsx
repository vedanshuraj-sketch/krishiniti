import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

export default function CropLotScreen() {
  const [crop, setCrop] = useState('');
  const [quantity, setQuantity] = useState('');
  const [grade, setGrade] = useState('');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  const [certificate, setCertificate] =
  useState<DocumentPicker.DocumentPickerAsset | null>(null);

 const handleSubmit = () => {
  if (!crop || !quantity || !grade || !price || !location || !certificate) {
    Alert.alert(
      'Incomplete form',
      'Please fill in all fields and upload the crop certificate.',
    );
    return;
  }

  Alert.alert(
    'Crop lot listed',
    `${crop} • ${quantity} quintals\nExpected price: ₹${price} / quintal\nLocation: ${location}`,
    [
      {
        text: 'OK',
        onPress: () => {
          // Clear all fields
          setCrop('');
          setQuantity('');
          setGrade('');
          setPrice('');
          setLocation('');
          setCertificate(null);
        },
      },
    ],
  );
};
  const handleCertificateUpload = async () => {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (!result.canceled) {
    setCertificate(result.assets[0]);
  }
};

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>FARMER MARKET</Text>

        <Text style={styles.title}>List your crop lot</Text>

        <Text style={styles.subtitle}>
          Add your harvest details so buyers can discover your crop.
        </Text>

        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>Crop details</Text>

          <Text style={styles.label}>CROP</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Tomato"
            placeholderTextColor="#9AA39C"
            value={crop}
            onChangeText={setCrop}
          />

          <Text style={styles.label}>QUANTITY</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 25"
            placeholderTextColor="#9AA39C"
            keyboardType="numeric"
            value={quantity}
            onChangeText={setQuantity}
          />

          <Text style={styles.helper}>Quantity in quintals</Text>

          <Text style={styles.label}>QUALITY / GRADE</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Grade A"
            placeholderTextColor="#9AA39C"
            value={grade}
            onChangeText={setGrade}
          />

          <Text style={styles.sectionTitle2}>Selling details</Text>

          <Text style={styles.label}>EXPECTED PRICE</Text>
          <View style={styles.priceInputRow}>
            <Text style={styles.rupee}>₹</Text>
            <TextInput
              style={styles.priceInput}
              placeholder="e.g. 2720"
              placeholderTextColor="#9AA39C"
              keyboardType="numeric"
              value={price}
              onChangeText={setPrice}
            />
          </View>

          <Text style={styles.helper}>Expected price per quintal</Text>

          <Text style={styles.label}>LOCATION</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Ahmedabad"
            placeholderTextColor="#9AA39C"
            value={location}
            onChangeText={setLocation}
          />

          <Text style={styles.label}>CROP CERTIFICATE</Text>

<Pressable
  style={({ pressed }) => [
    styles.uploadBox,
    pressed && styles.buttonPressed,
  ]}
  onPress={handleCertificateUpload}
>
  <View style={styles.uploadIcon}>
    <Text style={styles.uploadIconText}>↑</Text>
  </View>

  <View style={styles.uploadContent}>
    <Text style={styles.uploadTitle}>
      {certificate ? certificate.name : 'Upload certificate'}
    </Text>

    <Text style={styles.uploadHelper}>
      {certificate
        ? 'Certificate selected'
        : 'PDF or image • Max 10 MB'}
    </Text>
  </View>

  <Text style={styles.uploadAction}>
    {certificate ? 'Change' : 'Choose'}
  </Text>
</Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={handleSubmit}
          >
            <Text style={styles.submitText}>List crop lot</Text>
            <Text style={styles.arrow}>→</Text>
          </Pressable>
        </View>

        <View style={styles.note}>
          <Text style={styles.noteIcon}>✓</Text>

          <View style={styles.noteContent}>
            <Text style={styles.noteTitle}>Buyer visibility</Text>
            <Text style={styles.noteText}>
              Your crop lot can be shown to buyers looking for fresh products.
            </Text>
          </View>
        </View>
      </ScrollView>
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
    paddingTop: 22,
    paddingBottom: 36,
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
    marginBottom: 20,
    maxWidth: 340,
  },

  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E1E7DF',
  },

  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#172019',
    marginBottom: 16,
    
  },
sectionTitle2: {
    fontSize: 17,
    fontWeight: '800',
    color: '#172019',
    marginBottom: 16,
    marginTop:16,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: '#737D76',
    marginBottom: 7,
    marginTop: 14,
  },

  input: {
    height: 48,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#DDE4DA',
    backgroundColor: '#FAFBF9',
    paddingHorizontal: 14,
    fontSize: 14,
    color: '#172019',
  },

  helper: {
    fontSize: 10,
    color: '#8A938C',
    marginTop: 5,
  },

  priceInputRow: {
    height: 48,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#DDE4DA',
    backgroundColor: '#FAFBF9',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },

  rupee: {
    fontSize: 17,
    fontWeight: '700',
    color: '#315B38',
    marginRight: 5,
  },

  priceInput: {
    flex: 1,
    fontSize: 14,
    color: '#172019',
  },

  uploadBox: {
  minHeight: 64,
  borderRadius: 13,
  borderWidth: 1,
  borderColor: '#DDE4DA',
  borderStyle: 'dashed',
  backgroundColor: '#FAFBF9',
  paddingHorizontal: 12,
  paddingVertical: 10,
  flexDirection: 'row',
  alignItems: 'center',
},

uploadIcon: {
  width: 38,
  height: 38,
  borderRadius: 11,
  backgroundColor: '#EAF1E7',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 11,
},

uploadIconText: {
  fontSize: 20,
  fontWeight: '700',
  color: '#315B38',
},

uploadContent: {
  flex: 1,
},

uploadTitle: {
  fontSize: 12,
  fontWeight: '700',
  color: '#172019',
},

uploadHelper: {
  fontSize: 10,
  color: '#8A938C',
  marginTop: 3,
},

uploadAction: {
  fontSize: 11,
  fontWeight: '800',
  color: '#315B38',
  marginLeft: 8,
},

  submitButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#315B38',
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  buttonPressed: {
    opacity: 0.8,
  },

  submitText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  arrow: {
    fontSize: 18,
    color: '#FFFFFF',
    marginLeft: 8,
  },

  note: {
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#EAF1E7',
    flexDirection: 'row',
    alignItems: 'center',
  },

  noteIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#D9E7D4',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: '#315B38',
    marginRight: 11,
  },

  noteContent: {
    flex: 1,
  },

  noteTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#315B38',
    marginBottom: 3,
  },

  noteText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#526356',
  },
});