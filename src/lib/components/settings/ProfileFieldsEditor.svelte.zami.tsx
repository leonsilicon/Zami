import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
    Image,
    mediaSource,
    pickedFile,
    Portal,
    Select,
} from "@-/com.leonsilicon.zami.rn";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { t } from "$lib/i18n";
import {
    fetchOwnExtendedProfile,
    mxcToHttp,
    setOwnProfileField,
    uploadContent,
} from "$lib/matrix/client";
import { Smile } from "lucide-svelte";
import EmojiPicker from "$lib/components/ui/EmojiPicker.svelte";
import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { changeOwnStatusMessage } from "$lib/stores/presence.svelte";
import { setShareCallStatus, settingsState } from "$lib/stores/settings.svelte";
import { setCachedProfile } from "$lib/stores/profileFields.svelte";
import {
    DEFAULT_COLOUR_ON_DARK,
    DEFAULT_COLOUR_ON_LIGHT,
    MAX_BIOGRAPHY_LENGTH,
    MAX_CONNECTIONS,
    MAX_CONNECTION_DESCRIPTION,
    MAX_STATUS_EMOJI_LENGTH,
    MAX_STATUS_TEXT_LENGTH,
    PROFILE_FIELDS,
    buildBiography,
    buildConnections,
    buildStatus,
    connectionsProblem,
    groupTimezones,
    joinTimezone,
    knownTimezones,
    parseBanner,
    parseBiography,
    parseColourPreference,
    parseConnections,
    parsePronouns,
    parseStatus,
    parseTimezone,
    splitTimezone,
    timezoneCityLabel,
    planFieldWrite,
    formatStatusMessage,
    planLegacyStatusMirror,
    pronounsToText,
    readField,
    statusProblem,
    textToPronouns,
    type ExtendedProfile,
    type FieldKeys,
    type FieldOp,
    type ProfileConnection,
} from "$lib/utils/extendedProfile";
import {
    profileFieldAllowed,
    type Capabilities,
} from "$lib/utils/serverCapabilities";
import { normalizeHex } from "$lib/utils/themePalette";

interface Props {
    capabilities: Capabilities | null;
    displayName: string;
}

// Zami: upstream's `saved*` deriveds of `extProfile`, as one function, so
// resetDrafts can read them for the copy just fetched (React state set in the
// same handler isn't read back until the next render).
function savedFields(extProfile: ExtendedProfile | null) {
    return {
        savedPronouns: parsePronouns(
            readField(extProfile, PROFILE_FIELDS.pronouns),
        ),
        savedStatus: parseStatus(readField(extProfile, PROFILE_FIELDS.status)),
        savedBio: parseBiography(
            readField(extProfile, PROFILE_FIELDS.biography),
        ),
        savedTimezone:
            parseTimezone(readField(extProfile, PROFILE_FIELDS.timezone)) ?? "",
        savedBanner: parseBanner(readField(extProfile, PROFILE_FIELDS.banner)),
        savedColour: parseColourPreference(
            readField(extProfile, PROFILE_FIELDS.usernameColour),
        ),
        savedConnections: parseConnections(
            readField(extProfile, PROFILE_FIELDS.connections),
        ),
    };
}

const inputClass =
    "w-full bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none";
const smallButtonClass =
    "px-2 py-1 rounded hover:bg-discord-messageHover disabled:opacity-30 transition-colors";
// Zami: the text half of smallButtonClass, for the Text inside.
const smallButtonTextClass =
    "text-discord-textMuted hover:text-discord-textPrimary";

// Zami: `space-y-*` (a child selector) does nothing in React Native; the same `gap-*`
// spaces the children instead. Text classes sit on each Text; `block` is dropped. A
// `<label>`'s text is its input's accessibilityLabel, and an icon-only button's
// `title` becomes its accessibilityLabel.
export default function ProfileFieldsEditor({
    capabilities,
    displayName,
}: Props) {
    const userId = useRune(() => auth.userId);
    const shareCallStatus = useRune(() => settingsState.shareCallStatus);

    // `extProfile` is the last server copy; the draft values are what the
    // inputs edit. Each field is dirty when its draft differs from the copy.
    const [extProfile, setExtProfile] = useState<ExtendedProfile | null>(null);
    const [pronounsText, setPronounsText] = useState("");
    const [statusText, setStatusText] = useState("");
    const [statusEmoji, setStatusEmoji] = useState("");
    const [bioText, setBioText] = useState("");
    const [timezoneText, setTimezoneText] = useState("");
    // The region half of the two-step timezone picker. Kept apart from
    // timezoneText because a region can be chosen before its city.
    const [tzRegion, setTzRegion] = useState("");
    const [bannerMxc, setBannerMxc] = useState<string | null>(null);
    const [colourDark, setColourDark] = useState<string | null>(null);
    const [colourLight, setColourLight] = useState<string | null>(null);
    const [connectionRows, setConnectionRows] = useState<ProfileConnection[]>(
        [],
    );

    const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
    // Zami: the keyboard's height, which the picker sheet sits above.
    const keyboardHeight = useKeyboardState((state) => state.height);
    // Zami: no bannerInput; the button opens the photo library.
    const [bannerUploading, setBannerUploading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);

    const [timezones] = useState(knownTimezones);
    const tzGroups = groupTimezones(timezones, [
        parseTimezone(timezoneText),
        parseTimezone(readField(extProfile, PROFILE_FIELDS.timezone)),
    ]);
    const tzCity = timezoneText ? splitTimezone(timezoneText).city : "";

    const {
        savedPronouns,
        savedStatus,
        savedBio,
        savedTimezone,
        savedBanner,
        savedColour,
        savedConnections,
    } = savedFields(extProfile);

    const allowed = (field: FieldKeys) =>
        profileFieldAllowed(field.unstable ?? field.stable, capabilities);

    const pronounsDirty = pronounsText.trim() !== pronounsToText(savedPronouns);
    const statusDirty =
        statusText.trim() !== (savedStatus?.text ?? "") ||
        statusEmoji.trim() !== (savedStatus?.emoji ?? "");
    const bioDirty = bioText.trim() !== savedBio.trim();
    const timezoneDirty = timezoneText.trim() !== savedTimezone;
    const bannerDirty = bannerMxc !== savedBanner;
    const colourDirty =
        colourDark !== (savedColour?.on_dark ?? null) ||
        colourLight !== (savedColour?.on_light ?? null);
    const connectionsDirty =
        JSON.stringify(buildConnections(connectionRows) ?? []) !==
        JSON.stringify(savedConnections);

    const statusIssue = statusProblem(statusText, statusEmoji);
    const timezoneIssue =
        timezoneText.trim() && !parseTimezone(timezoneText)
            ? t("profileFieldsEditor.useATimezoneNameLikeEurope")
            : tzRegion && !timezoneText.trim()
              ? t("profileFieldsEditor.chooseACity2")
              : null;
    const connectionsIssue = connectionsProblem(connectionRows);
    const problem = statusIssue ?? timezoneIssue ?? connectionsIssue;

    const dirty =
        (pronounsDirty && allowed(PROFILE_FIELDS.pronouns)) ||
        (statusDirty && allowed(PROFILE_FIELDS.status)) ||
        (bioDirty && allowed(PROFILE_FIELDS.biography)) ||
        (timezoneDirty && allowed(PROFILE_FIELDS.timezone)) ||
        (bannerDirty && allowed(PROFILE_FIELDS.banner)) ||
        (colourDirty && allowed(PROFILE_FIELDS.usernameColour)) ||
        (connectionsDirty && allowed(PROFILE_FIELDS.connections));

    const bannerSrc = mxcToHttp(bannerMxc, 480, 160, "crop");

    // Zami: takes the server copy whose saved values the drafts reset to.
    function resetDrafts(profile: ExtendedProfile | null) {
        const s = savedFields(profile);
        setPronounsText(pronounsToText(s.savedPronouns));
        setStatusText(s.savedStatus?.text ?? "");
        setStatusEmoji(s.savedStatus?.emoji ?? "");
        setBioText(s.savedBio);
        setTimezone(s.savedTimezone);
        setBannerMxc(s.savedBanner);
        setColourDark(s.savedColour?.on_dark ?? null);
        setColourLight(s.savedColour?.on_light ?? null);
        setConnectionRows(s.savedConnections.map((c) => ({ ...c })));
    }

    function setTimezone(zone: string) {
        setTimezoneText(zone);
        setTzRegion(zone ? splitTimezone(zone).region : "");
    }

    function useBrowserTimezone() {
        setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }

    function chooseTzRegion(region: string) {
        setTzRegion(region);
        // A new region has no city yet; the old zone no longer applies.
        if (!timezoneText || splitTimezone(timezoneText).region !== region) {
            setTimezoneText("");
        }
    }

    function chooseTzCity(city: string) {
        setTimezoneText(city ? joinTimezone(tzRegion, city) : "");
    }

    function chooseColour() {
        setColourDark(DEFAULT_COLOUR_ON_DARK);
        setColourLight(DEFAULT_COLOUR_ON_LIGHT);
    }

    function clearColour() {
        setColourDark(null);
        setColourLight(null);
    }

    async function selectBanner() {
        // Zami: <input type="file" accept="image/*"> → expo-image-picker.
        const file = await pickBanner();
        if (!file) return;
        setBannerUploading(true);
        setError("");
        try {
            setBannerMxc(await uploadContent(file));
        } catch (e) {
            setError(
                (e as Error)?.message ??
                    t("profileFieldsEditor.bannerUploadFailed"),
            );
        } finally {
            setBannerUploading(false);
        }
    }

    function addConnection() {
        if (connectionRows.length >= MAX_CONNECTIONS) return;
        setConnectionRows([...connectionRows, { description: "", uri: "" }]);
    }

    function removeConnection(index: number) {
        setConnectionRows(connectionRows.filter((_, i) => i !== index));
    }

    // Zami: `bind:value={row.description}` / `{row.uri}` write into the row.
    function setConnection(index: number, patch: Partial<ProfileConnection>) {
        setConnectionRows((rows) =>
            rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
        );
    }

    async function save() {
        if (busy || !dirty || problem) return;
        setBusy(true);
        setError("");
        const ops: FieldOp[] = [];
        const plan = (
            field: FieldKeys,
            isDirty: boolean,
            value: unknown | null,
        ) => {
            if (isDirty && allowed(field)) {
                ops.push(...planFieldWrite(extProfile, field, value));
            }
        };
        const pronouns = textToPronouns(
            pronounsText,
            savedPronouns,
            navigator.language.split("-")[0] || "en",
        );
        plan(
            PROFILE_FIELDS.pronouns,
            pronounsDirty,
            pronouns.length ? pronouns : null,
        );
        const status = buildStatus(statusText, statusEmoji);
        plan(PROFILE_FIELDS.status, statusDirty, status);
        if (statusDirty && allowed(PROFILE_FIELDS.status)) {
            ops.push(...planLegacyStatusMirror(extProfile, status));
        }
        plan(PROFILE_FIELDS.biography, bioDirty, buildBiography(bioText));
        plan(
            PROFILE_FIELDS.timezone,
            timezoneDirty,
            parseTimezone(timezoneText),
        );
        plan(PROFILE_FIELDS.banner, bannerDirty, bannerMxc);
        plan(
            PROFILE_FIELDS.usernameColour,
            colourDirty,
            colourDark && colourLight
                ? { on_dark: colourDark, on_light: colourLight }
                : null,
        );
        plan(
            PROFILE_FIELDS.connections,
            connectionsDirty,
            buildConnections(connectionRows),
        );
        try {
            for (const op of ops) await setOwnProfileField(op.key, op.value);
            if (statusDirty && allowed(PROFILE_FIELDS.status)) {
                // Sable shows only the presence message. A server with
                // presence off must not fail the profile save.
                await changeOwnStatusMessage(formatStatusMessage(status)).catch(
                    () => {},
                );
            }
            const next = await fetchOwnExtendedProfile();
            setExtProfile(next);
            if (auth.userId) setCachedProfile(auth.userId, next);
            resetDrafts(next);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e) {
            setError(
                (e as Error)?.message ??
                    t("profileFieldsEditor.failedToSaveProfileFields"),
            );
        } finally {
            setBusy(false);
        }
    }

    useEffect(() => {
        fetchOwnExtendedProfile()
            .then((profile) => {
                setExtProfile(profile);
                resetDrafts(profile);
            })
            .catch(() => {
                setExtProfile(null);
            });
    }, []);

    if (!extProfile) return null;
    return (
        <View className="gap-4">
            <Text className="text-xs font-semibold text-discord-textMuted uppercase tracking-wide">
                {t("profileFieldsEditor.moreAboutYou")}
            </Text>

            {allowed(PROFILE_FIELDS.banner) && (
                <View>
                    <Text className="text-sm text-discord-textPrimary">
                        {t("profileFieldsEditor.banner")}
                    </Text>
                    {bannerSrc ? (
                        <Image
                            source={mediaSource(bannerSrc)}
                            accessibilityLabel={t(
                                "profileFieldsEditor.yourBanner",
                            )}
                            accessible
                            contentFit="cover"
                            className="mt-1 h-20 w-full max-w-sm rounded"
                        />
                    ) : null}
                    <View className="mt-1 flex-row gap-2">
                        <Pressable
                            accessibilityRole="button"
                            onPress={selectBanner}
                            disabled={bannerUploading}
                            className="px-3 py-1.5 bg-discord-accent rounded disabled:opacity-50"
                        >
                            <Text className="text-white text-sm">
                                {bannerUploading
                                    ? t("common.uploading")
                                    : t("profileFieldsEditor.changeBanner")}
                            </Text>
                        </Pressable>
                        {bannerMxc ? (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => setBannerMxc(null)}
                                className="px-3 py-1.5 bg-discord-backgroundTertiary rounded"
                            >
                                <Text className="text-discord-textPrimary text-sm">
                                    {t("common.remove")}
                                </Text>
                            </Pressable>
                        ) : null}
                    </View>
                </View>
            )}

            {allowed(PROFILE_FIELDS.call) && (
                <View className="flex-row items-center gap-3">
                    <View className="flex-1 min-w-0">
                        <Text className="text-sm text-discord-textPrimary">
                            {t("profileFieldsEditor.showWhenIAmInA")}
                        </Text>
                        <Text className="text-xs text-discord-textMuted">
                            {t("profileFieldsEditor.addsInACallToYour")}
                        </Text>
                    </View>
                    <ToggleSwitch
                        checked={shareCallStatus}
                        onChange={setShareCallStatus}
                        label={t("profileFieldsEditor.showWhenIAmInA")}
                    />
                </View>
            )}

            {allowed(PROFILE_FIELDS.pronouns) && (
                <View>
                    <Text className="text-sm text-discord-textPrimary">
                        {t("profileFieldsEditor.pronouns")}
                    </Text>
                    <TextInput
                        value={pronounsText}
                        onChangeText={setPronounsText}
                        placeholder={t("profileFieldsEditor.sheHerTheyThem")}
                        placeholderTextColorClassName="accent-discord-textMuted"
                        accessibilityLabel={t("profileFieldsEditor.pronouns")}
                        autoCapitalize="none"
                        className={`mt-1 ${inputClass}`}
                    />
                    <Text className="text-xs text-discord-textMuted">
                        {t(
                            "profileFieldsEditor.separateWithCommasMostPreferredFirst",
                        )}
                    </Text>
                </View>
            )}

            {allowed(PROFILE_FIELDS.status) && (
                <View>
                    <Text className="text-sm text-discord-textPrimary">
                        {t("profileFieldsEditor.status")}
                    </Text>
                    <View className="mt-1 flex-row gap-2">
                        <TextInput
                            value={statusEmoji}
                            onChangeText={setStatusEmoji}
                            maxLength={MAX_STATUS_EMOJI_LENGTH}
                            placeholder="🌴"
                            placeholderTextColorClassName="accent-discord-textMuted"
                            accessibilityLabel={t(
                                "profileFieldsEditor.statusEmoji",
                            )}
                            className="w-16 bg-discord-backgroundTertiary text-discord-textPrimary text-sm text-center rounded px-2 py-2 outline-none"
                        />
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => setEmojiPickerOpen(!emojiPickerOpen)}
                            accessibilityLabel={t(
                                "profileFieldsEditor.pickAStatusEmoji",
                            )}
                            accessibilityState={{ expanded: emojiPickerOpen }}
                            className="px-2 justify-center rounded bg-discord-backgroundTertiary"
                        >
                            <Smile
                                size={18}
                                className="text-discord-textMuted hover:text-discord-textPrimary"
                            />
                        </Pressable>
                        <TextInput
                            value={statusText}
                            onChangeText={setStatusText}
                            maxLength={MAX_STATUS_TEXT_LENGTH}
                            placeholder={t(
                                "profileFieldsEditor.onHolidayUntilThe23rd",
                            )}
                            placeholderTextColorClassName="accent-discord-textMuted"
                            accessibilityLabel={t(
                                "profileFieldsEditor.statusText",
                            )}
                            className="flex-1 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none"
                        />
                    </View>
                    {/* Zami: the picker is a list, which can't sit inline in
                        the settings' scroll view: it opens over the app as a
                        sheet, as the touch reaction picker does, and a press
                        outside it closes it. */}
                    {emojiPickerOpen && (
                        <Portal>
                            <View
                                className="absolute inset-0"
                                pointerEvents="box-none"
                            >
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={t("common.close")}
                                    className="absolute inset-0 z-40"
                                    onPress={() => setEmojiPickerOpen(false)}
                                />
                                <View
                                    className="absolute start-0 end-0 z-50"
                                    style={{
                                        bottom: Math.max(0, keyboardHeight),
                                    }}
                                >
                                    <EmojiPicker
                                        unicodeOnly
                                        onSelect={(emoji) =>
                                            setStatusEmoji(emoji)
                                        }
                                        onClose={() =>
                                            setEmojiPickerOpen(false)
                                        }
                                    />
                                </View>
                            </View>
                        </Portal>
                    )}
                    {statusIssue ? (
                        <Text className="mt-1 text-xs text-discord-danger">
                            {statusIssue}
                        </Text>
                    ) : null}
                </View>
            )}

            {allowed(PROFILE_FIELDS.biography) && (
                <View>
                    <Text className="text-sm text-discord-textPrimary">
                        {t("profileFieldsEditor.bio")}
                    </Text>
                    {/* Zami: rows="4" → numberOfLines (Android) and a four-line
                        minimum height; `resize-y` has no equivalent. */}
                    <TextInput
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        value={bioText}
                        onChangeText={setBioText}
                        maxLength={MAX_BIOGRAPHY_LENGTH}
                        placeholder={t(
                            "profileFieldsEditor.tellPeopleAboutYourself",
                        )}
                        placeholderTextColorClassName="accent-discord-textMuted"
                        accessibilityLabel={t("profileFieldsEditor.bio")}
                        className={`mt-1 min-h-24 ${inputClass}`}
                    />
                </View>
            )}

            {allowed(PROFILE_FIELDS.timezone) && (
                <View>
                    <Text className="text-sm text-discord-textPrimary">
                        {t("profileFieldsEditor.timezone")}
                    </Text>
                    <View className="mt-1 flex-row gap-2">
                        {timezones.length > 0 ? (
                            <>
                                <Select
                                    value={tzRegion}
                                    onChange={chooseTzRegion}
                                    accessibilityLabel={t(
                                        "profileFieldsEditor.timezoneRegion",
                                    )}
                                    className="w-2/5 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-2 py-2 outline-none"
                                    options={[
                                        {
                                            value: "",
                                            label: t(
                                                "profileFieldsEditor.notSet",
                                            ),
                                        },
                                        ...tzGroups.regions.map((region) => ({
                                            value: region,
                                            label: region,
                                        })),
                                    ]}
                                />
                                <Select
                                    value={tzCity}
                                    onChange={chooseTzCity}
                                    disabled={!tzRegion}
                                    accessibilityLabel={t(
                                        "profileFieldsEditor.timezoneCity",
                                    )}
                                    className="flex-1 min-w-0 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-2 py-2 outline-none disabled:opacity-50"
                                    options={[
                                        {
                                            value: "",
                                            label: t(
                                                "profileFieldsEditor.chooseACity",
                                            ),
                                        },
                                        ...(
                                            tzGroups.cities[tzRegion] ?? []
                                        ).map((city) => ({
                                            value: city,
                                            label: timezoneCityLabel(city),
                                        })),
                                    ]}
                                />
                            </>
                        ) : (
                            // Old engines cannot list zones: type the name.
                            <TextInput
                                value={timezoneText}
                                onChangeText={setTimezoneText}
                                placeholder={t(
                                    "profileFieldsEditor.europeLondon",
                                )}
                                placeholderTextColorClassName="accent-discord-textMuted"
                                accessibilityLabel={t(
                                    "profileFieldsEditor.timezone",
                                )}
                                autoCapitalize="none"
                                autoCorrect={false}
                                className="flex-1 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none"
                            />
                        )}
                        <Pressable
                            accessibilityRole="button"
                            onPress={useBrowserTimezone}
                            className="px-3 py-1.5 justify-center bg-discord-backgroundTertiary rounded"
                        >
                            <Text className="text-discord-textPrimary text-sm">
                                {t("profileFieldsEditor.useMine")}
                            </Text>
                        </Pressable>
                    </View>
                    {timezoneIssue ? (
                        <Text className="mt-1 text-xs text-discord-danger">
                            {timezoneIssue}
                        </Text>
                    ) : null}
                </View>
            )}

            {allowed(PROFILE_FIELDS.usernameColour) && (
                <View>
                    <Text className="text-sm text-discord-textPrimary">
                        {t("profileFieldsEditor.usernameColour")}
                    </Text>
                    {colourDark && colourLight ? (
                        <View className="mt-1 flex-row flex-wrap items-center gap-3">
                            <View className="flex-row items-center gap-2">
                                <ColourInput
                                    value={colourDark}
                                    onChange={setColourDark}
                                    accessibilityLabel={t(
                                        "profileFieldsEditor.usernameColourOnDarkThemes",
                                    )}
                                />
                                <View
                                    className="px-2 py-1 rounded"
                                    style={{ backgroundColor: "#1e1f22" }}
                                >
                                    <Text
                                        className="text-sm font-medium"
                                        style={{ color: colourDark }}
                                    >
                                        {displayName || userId}
                                    </Text>
                                </View>
                                <Text className="text-xs text-discord-textMuted">
                                    {t("profileFieldsEditor.darkThemes")}
                                </Text>
                            </View>
                            <View className="flex-row items-center gap-2">
                                <ColourInput
                                    value={colourLight}
                                    onChange={setColourLight}
                                    accessibilityLabel={t(
                                        "profileFieldsEditor.usernameColourOnLightThemes",
                                    )}
                                />
                                <View
                                    className="px-2 py-1 rounded"
                                    style={{ backgroundColor: "#ffffff" }}
                                >
                                    <Text
                                        className="text-sm font-medium"
                                        style={{ color: colourLight }}
                                    >
                                        {displayName || userId}
                                    </Text>
                                </View>
                                <Text className="text-xs text-discord-textMuted">
                                    {t("profileFieldsEditor.lightThemes")}
                                </Text>
                            </View>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t(
                                    "profileFieldsEditor.resetToDefault",
                                )}
                                className={smallButtonClass}
                                onPress={clearColour}
                            >
                                <Text className={smallButtonTextClass}>✕</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <View className="mt-1 flex-row">
                            <Pressable
                                accessibilityRole="button"
                                onPress={chooseColour}
                                className="px-3 py-1.5 bg-discord-backgroundTertiary rounded"
                            >
                                <Text className="text-discord-textPrimary text-sm">
                                    {t("profileFieldsEditor.chooseAColour")}
                                </Text>
                            </Pressable>
                        </View>
                    )}
                    <Text className="text-xs text-discord-textMuted">
                        {t("profileFieldsEditor.oneColourForDarkThemesAnd")}
                    </Text>
                </View>
            )}

            {allowed(PROFILE_FIELDS.connections) && (
                <View>
                    <Text className="text-sm text-discord-textPrimary">
                        {t("profileFieldsEditor.links")}
                    </Text>
                    <View className="mt-1 gap-2">
                        {connectionRows.map((row, index) => (
                            <View key={index} className="flex-row gap-2">
                                <TextInput
                                    value={row.description}
                                    onChangeText={(description) =>
                                        setConnection(index, { description })
                                    }
                                    maxLength={MAX_CONNECTION_DESCRIPTION}
                                    placeholder={t("profileFieldsEditor.label")}
                                    placeholderTextColorClassName="accent-discord-textMuted"
                                    accessibilityLabel={t(
                                        "profileFieldsEditor.linkLabel",
                                    )}
                                    className="w-1/3 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none"
                                />
                                <TextInput
                                    value={row.uri}
                                    onChangeText={(uri) =>
                                        setConnection(index, { uri })
                                    }
                                    placeholder={t(
                                        "profileFieldsEditor.httpsExampleOrg",
                                    )}
                                    placeholderTextColorClassName="accent-discord-textMuted"
                                    accessibilityLabel={t(
                                        "profileFieldsEditor.linkAddress",
                                    )}
                                    keyboardType="url"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    className="flex-1 bg-discord-backgroundTertiary text-discord-textPrimary text-sm rounded px-3 py-2 outline-none"
                                />
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={t(
                                        "profileFieldsEditor.removeLink",
                                    )}
                                    className={`justify-center ${smallButtonClass}`}
                                    onPress={() => removeConnection(index)}
                                >
                                    <Text className={smallButtonTextClass}>
                                        ✕
                                    </Text>
                                </Pressable>
                            </View>
                        ))}
                        <Pressable
                            accessibilityRole="button"
                            onPress={addConnection}
                            disabled={connectionRows.length >= MAX_CONNECTIONS}
                            className="self-start px-3 py-1.5 bg-discord-backgroundTertiary rounded disabled:opacity-50"
                        >
                            <Text className="text-discord-textPrimary text-sm">
                                {t("profileFieldsEditor.addLink")}
                            </Text>
                        </Pressable>
                    </View>
                    {connectionsIssue ? (
                        <Text className="mt-1 text-xs text-discord-danger">
                            {connectionsIssue}
                        </Text>
                    ) : null}
                </View>
            )}

            <View className="flex-row items-center gap-3">
                <Pressable
                    accessibilityRole="button"
                    onPress={save}
                    disabled={busy || !dirty || !!problem || bannerUploading}
                    className="px-4 py-2 bg-discord-accent rounded disabled:opacity-50"
                >
                    <Text className="text-white text-sm">
                        {busy ? t("common.saving") : t("common.save")}
                    </Text>
                </Pressable>
                {error ? (
                    <Text className="text-xs text-discord-danger">{error}</Text>
                ) : saved ? (
                    <Text className="text-xs text-discord-textPositive">
                        {t("profileFieldsEditor.saved")}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}

// Zami: React Native has no <input type="color">: a swatch shows the colour and its
// hex code is an input, applied whenever it holds a valid #rgb or #rrggbb (as the
// lower-case #rrggbb the browser's picker gives).
// Zami: not ported: a visual colour picker; colours are typed as hex.
function ColourInput({
    value,
    onChange,
    accessibilityLabel,
}: {
    value: string;
    onChange: (value: string) => void;
    accessibilityLabel: string;
}) {
    const [text, setText] = useState(value);
    // Follow the colour when it changes from outside, but not while what's typed
    // already means it (#abc for #aabbcc).
    const [shown, setShown] = useState(value);
    if (value !== shown) {
        setShown(value);
        if (normalizeHex(text) !== value) setText(value);
    }
    return (
        <View className="flex-row items-center gap-1">
            <View
                className="w-10 h-8 rounded border border-discord-divider"
                style={{ backgroundColor: value }}
            />
            <TextInput
                value={text}
                onChangeText={(next) => {
                    setText(next);
                    const hex = normalizeHex(next);
                    if (hex) onChange(hex);
                }}
                onEndEditing={() => setText(value)}
                accessibilityLabel={accessibilityLabel}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={7}
                className="text-xs text-discord-textMuted font-mono w-16"
            />
        </View>
    );
}

// Zami: <input type="file" accept="image/*"> → expo-image-picker. Resolves to the
// picked image as a File, or null when cancelled.
async function pickBanner(): Promise<File | null> {
    const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return null;
    return pickedFile(asset);
}
