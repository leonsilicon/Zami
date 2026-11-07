import ExpoModulesCore
import UIKit

/// Sends every hardware key press and release as an `onKey` event, shaped like a DOM
/// KeyboardEvent (`type`, `key`, `code`, modifiers, `repeat`). It observes
/// `UIApplication.sendEvent`, so presses arrive whatever has focus, a text field included.
public class ZamiKeyboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZamiKeyboard")
    Events("onKey")

    OnStartObserving {
      KeyPressObserver.shared.listener = { [weak self] payload in
        self?.sendEvent("onKey", payload)
      }
      KeyPressObserver.install()
    }

    OnStopObserving {
      KeyPressObserver.shared.listener = nil
    }
  }
}

final class KeyPressObserver {
  static let shared = KeyPressObserver()
  var listener: (([String: Any]) -> Void)?
  private var held = Set<Int>()
  private static var installed = false

  static func install() {
    guard !installed else { return }
    installed = true
    guard
      let original = class_getInstanceMethod(UIApplication.self, #selector(UIApplication.sendEvent(_:))),
      let replacement = class_getInstanceMethod(UIApplication.self, #selector(UIApplication.zamiKeyboard_sendEvent(_:)))
    else { return }
    method_exchangeImplementations(original, replacement)
  }

  func handle(_ event: UIEvent) {
    guard let listener, let presses = event as? UIPressesEvent else { return }
    for press in presses.allPresses {
      guard let key = press.key else { continue }
      let usage = key.keyCode.rawValue
      let type: String
      var isRepeat = false
      switch press.phase {
      case .began:
        type = "keydown"
        isRepeat = held.contains(usage)
        held.insert(usage)
      case .ended, .cancelled:
        type = "keyup"
        held.remove(usage)
      default:
        continue
      }
      let flags = key.modifierFlags
      listener([
        "type": type,
        "key": KeyPressObserver.domKey(key),
        "code": KeyPressObserver.domCode(key.keyCode),
        "keyCode": usage,
        "shiftKey": flags.contains(.shift),
        "ctrlKey": flags.contains(.control),
        "altKey": flags.contains(.alternate),
        "metaKey": flags.contains(.command),
        "repeat": isRepeat,
      ])
    }
  }

  /// The DOM `key`: the character typed, or the named key.
  static func domKey(_ key: UIKey) -> String {
    switch key.keyCode {
    case .keyboardReturnOrEnter, .keypadEnter: return "Enter"
    case .keyboardEscape: return "Escape"
    case .keyboardTab: return "Tab"
    case .keyboardDeleteOrBackspace: return "Backspace"
    case .keyboardDeleteForward: return "Delete"
    case .keyboardUpArrow: return "ArrowUp"
    case .keyboardDownArrow: return "ArrowDown"
    case .keyboardLeftArrow: return "ArrowLeft"
    case .keyboardRightArrow: return "ArrowRight"
    case .keyboardHome: return "Home"
    case .keyboardEnd: return "End"
    case .keyboardPageUp: return "PageUp"
    case .keyboardPageDown: return "PageDown"
    case .keyboardLeftShift, .keyboardRightShift: return "Shift"
    case .keyboardLeftControl, .keyboardRightControl: return "Control"
    case .keyboardLeftAlt, .keyboardRightAlt: return "Alt"
    case .keyboardLeftGUI, .keyboardRightGUI: return "Meta"
    case .keyboardCapsLock: return "CapsLock"
    case .keyboardSpacebar: return " "
    case .keyboardF1: return "F1"
    case .keyboardF2: return "F2"
    case .keyboardF3: return "F3"
    case .keyboardF4: return "F4"
    case .keyboardF5: return "F5"
    case .keyboardF6: return "F6"
    case .keyboardF7: return "F7"
    case .keyboardF8: return "F8"
    case .keyboardF9: return "F9"
    case .keyboardF10: return "F10"
    case .keyboardF11: return "F11"
    case .keyboardF12: return "F12"
    default:
      let flags = key.modifierFlags
      // With Shift (and no other modifier) the browser reports the shifted character.
      if flags.contains(.shift) && !flags.contains(.command) && !flags.contains(.control) && !key.characters.isEmpty {
        return key.characters
      }
      return key.charactersIgnoringModifiers.isEmpty ? "Unidentified" : key.charactersIgnoringModifiers
    }
  }

  /// The DOM `code`: the physical key, for the keys bindings use.
  static func domCode(_ code: UIKeyboardHIDUsage) -> String {
    let usage = code.rawValue
    if (0x04...0x1D).contains(usage) {
      return "Key" + String(UnicodeScalar(UInt8(65 + usage - 0x04)))
    }
    if (0x1E...0x26).contains(usage) { return "Digit\(usage - 0x1D)" }
    if usage == 0x27 { return "Digit0" }
    switch code {
    case .keyboardReturnOrEnter: return "Enter"
    case .keypadEnter: return "NumpadEnter"
    case .keyboardEscape: return "Escape"
    case .keyboardTab: return "Tab"
    case .keyboardDeleteOrBackspace: return "Backspace"
    case .keyboardSpacebar: return "Space"
    case .keyboardHyphen: return "Minus"
    case .keyboardEqualSign: return "Equal"
    case .keyboardOpenBracket: return "BracketLeft"
    case .keyboardCloseBracket: return "BracketRight"
    case .keyboardBackslash: return "Backslash"
    case .keyboardSemicolon: return "Semicolon"
    case .keyboardQuote: return "Quote"
    case .keyboardGraveAccentAndTilde: return "Backquote"
    case .keyboardComma: return "Comma"
    case .keyboardPeriod: return "Period"
    case .keyboardSlash: return "Slash"
    case .keyboardUpArrow: return "ArrowUp"
    case .keyboardDownArrow: return "ArrowDown"
    case .keyboardLeftArrow: return "ArrowLeft"
    case .keyboardRightArrow: return "ArrowRight"
    case .keyboardLeftShift: return "ShiftLeft"
    case .keyboardRightShift: return "ShiftRight"
    case .keyboardLeftControl: return "ControlLeft"
    case .keyboardRightControl: return "ControlRight"
    case .keyboardLeftAlt: return "AltLeft"
    case .keyboardRightAlt: return "AltRight"
    case .keyboardLeftGUI: return "MetaLeft"
    case .keyboardRightGUI: return "MetaRight"
    default: return "Unidentified"
    }
  }
}

extension UIApplication {
  @objc func zamiKeyboard_sendEvent(_ event: UIEvent) {
    KeyPressObserver.shared.handle(event)
    // Swapped with sendEvent(_:): this calls the original.
    zamiKeyboard_sendEvent(event)
  }
}
