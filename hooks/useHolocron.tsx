import { useState, useRef, useEffect } from 'react';
import { Platform } from 'react-native';
import * as ExpoAudio from 'expo-av';
import * as FileSystem from 'expo-file-system';
import axios from 'axios';

export const useHolocron = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [isAudioAvailable, setIsAudioAvailable] = useState(false);
  const recordingRef = useRef<ExpoAudio.Recording | null>(null);
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  // Check if audio is available on the platform
  useEffect(() => {
    const checkAudioAvailability = async () => {
      try {
        // Try to get permissions as a way to check availability
        const permission = await ExpoAudio.Audio.requestPermissionsAsync();
        setIsAudioAvailable(permission.granted);
      } catch (error) {
        console.error('Audio module not available:', error);
        setIsAudioAvailable(false);
      }
    };

    checkAudioAvailability();

    // Cleanup function
    return () => {
      // Unload recording if component unmounts
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(console.error);
      }
      // Unload sound if component unmounts
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(console.error);
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      console.log('Starting recording...');
      
      if (!isAudioAvailable) {
        throw new Error('Audio recording is not available on this platform');
      }

      const permission = await ExpoAudio.Audio.requestPermissionsAsync();
      if (!permission.granted) throw new Error('Permission denied');

      await ExpoAudio.Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        // Additional settings for Android
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const { recording } = await ExpoAudio.Audio.Recording.createAsync(
        ExpoAudio.Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );

      recordingRef.current = recording;
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  };

  const stopRecording = async () => {
    try {
      setIsRecording(false);
      if (!recordingRef.current) return;

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      if (!uri) throw new Error('No recording URI found');
      
      // On native platforms, check the status
      if (Platform.OS !== 'web') {
        const status = await recordingRef.current.getStatusAsync();
        console.log('Recording status:', status);
        console.log('Recording URI:', uri);
        
        if (!status.isDoneRecording) {
          throw new Error('Recording not completed properly');
        }
      } else {
        console.log('Recording URI (web):', uri);
      }
      
      setIsResponding(true);
      await sendToAI(uri);
    } catch (err) {
      console.error('Failed to stop recording:', err);
      setIsResponding(false);
    }
  };

  const sendToAI = async (uri: string) => {
    try {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL;
      if (!apiUrl) throw new Error('API_URL is not defined in environment variables');

      console.log('Sending to API:', `${apiUrl}/talk`);
      let formData = new FormData();

      if (Platform.OS === 'web') {
        // For web, fetch the blob from the blob URL
        const response = await fetch(uri);
        const blob = await response.blob();
        formData.append('file', blob, 'recording.mp3');
      } else {
        // For native platforms
        formData.append('file', {
          uri: uri,
          name: 'recording.mp3',
          type: 'audio/mpeg',
        } as any);
      }
      
      formData.append('context', "You are a helpful Jedi Holocron assistant. Help Padawans with their studies in the Force.");
      
      const aiResponse = await axios.post(`${apiUrl}/talk`, formData, {
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'multipart/form-data',
        },
        responseType: 'blob',
      });

      // Handle playing the audio response based on platform
      if (Platform.OS === 'web') {
        // For web, use the browser's audio API
        const audioUrl = URL.createObjectURL(aiResponse.data);
        const audioElement = new window.Audio(audioUrl);
        await audioElement.play();
      } else {
        // For native platforms
        // First convert blob to base64
        const base64data = await blobToBase64(aiResponse.data);
        
        // Save to filesystem
        const fileUri = `${FileSystem.cacheDirectory}response.mp3`;
        await FileSystem.writeAsStringAsync(fileUri, base64data, { 
          encoding: FileSystem.EncodingType.Base64 
        });
        
        // Play using expo-av
        if (soundRef.current) {
          await soundRef.current.unloadAsync();
        }
        
        const { sound } = await ExpoAudio.Audio.Sound.createAsync(
          { uri: fileUri },
          { shouldPlay: true }
        );
        
        soundRef.current = sound;
        
        // Set appropriate audio mode for playback
        await ExpoAudio.Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
        
        // Play sound
        await sound.playAsync();
      }
    } catch (err) {
      console.error('Failed to communicate with AI:', err);
      if (axios.isAxiosError(err)) {
        console.error('Status:', err.response?.status);
        console.error('Response data:', err.response?.data);
      }
    } finally {
      setIsResponding(false);
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result?.toString().split(',')[1];
        if (base64data) {
          resolve(base64data);
        } else {
          reject('Failed to convert blob to base64');
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  return {
    isRecording,
    isResponding,
    isAudioAvailable,
    startRecording,
    stopRecording,
  };
};