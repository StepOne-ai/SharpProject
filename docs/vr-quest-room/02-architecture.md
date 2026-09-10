# 2. Архитектура

## Главный принцип

Игровая логика живёт в обычных C#-классах, не наследующих `MonoBehaviour`.
Компоненты Unity — тонкие адаптеры: они читают ввод, вызывают методы логики и отражают
её состояние в сцене. Никаких `if` про правила игры внутри `Update`.

Это не academic purity, а практическая необходимость. Логика без Unity-зависимостей:

- покрывается юнит-тестами, которые бегут за секунды без шлема и без входа в Play Mode;
- отлаживается человеком, у которого сегодня нет доступа к устройству;
- переживает переделку сцены, а переделка сцены будет.

## Слои

```
┌──────────────────────────────────────────────────────────────┐
│  Presentation      MonoBehaviour-адаптеры, XR Interaction     │
│                    Toolkit, UI, звук, эффекты                 │
├──────────────────────────────────────────────────────────────┤
│  Application       RoomController, ProgressionService,        │
│                    HintService, TimerService, SessionRecorder │
├──────────────────────────────────────────────────────────────┤
│  Domain            IPuzzle, PuzzleState, Inventory,           │
│                    RoomState, доменные события                │
├──────────────────────────────────────────────────────────────┤
│  Infrastructure    SaveRepository (JSON), TelemetryWriter,    │
│                    ConfigLoader, AudioBackend                 │
└──────────────────────────────────────────────────────────────┘
```

Правило зависимостей: слой знает только о тех, что ниже. Domain не знает ни о чём.
Проверяется тем, что сборка `QuestRoom.Domain` (asmdef) не ссылается на `UnityEngine`.

## Структура папок

```
Assets/
  _Project/
    Scripts/
      Domain/            QuestRoom.Domain.asmdef      — без UnityEngine
      Application/       QuestRoom.Application.asmdef — без UnityEngine
      Infrastructure/    QuestRoom.Infrastructure.asmdef
      Presentation/      QuestRoom.Presentation.asmdef
      Tests/
        EditMode/        QuestRoom.Tests.EditMode.asmdef
        PlayMode/        QuestRoom.Tests.PlayMode.asmdef
    Prefabs/
      Puzzles/           по одному префабу на головоломку
      Interactables/
      Rig/
    Scenes/
      Boot.unity         загрузчик и сервисы
      Room.unity         комната, собранная из префабов
      Menu.unity
    Configs/             ScriptableObject-конфиги
    Audio/
    Art/
```

Асмдефы — не украшение. Именно они физически запрещают младшему участнику команды
дёрнуть `GameObject.Find` из доменного класса.

## Доменный слой

### Состояние головоломки

```csharp
namespace QuestRoom.Domain
{
    public enum PuzzleState
    {
        Locked,      // зависимости не выполнены, головоломка не реагирует
        Available,   // доступна для решения
        InProgress,  // игрок начал, есть промежуточное состояние
        Solved
    }
}
```

### Контракт головоломки

```csharp
namespace QuestRoom.Domain
{
    public interface IPuzzle
    {
        string Id { get; }
        PuzzleState State { get; }

        void Unlock();
        void Reset();

        /// <summary>Сериализуемое промежуточное состояние для сохранения.</summary>
        string CaptureState();
        void RestoreState(string payload);

        event Action<IPuzzle> StateChanged;
    }
}
```

`CaptureState` и `RestoreState` сознательно работают со строкой, а не с типизированным DTO:
каждая головоломка сама решает, что и как сериализовать, а хранилище про это ничего не знает.
Для П3 это будет список поднятых рубильников, для П2 — текущие цифры барабанов.

### Базовый класс

```csharp
namespace QuestRoom.Domain
{
    public abstract class PuzzleBase : IPuzzle
    {
        public string Id { get; }
        public PuzzleState State { get; private set; } = PuzzleState.Locked;

        public event Action<IPuzzle> StateChanged;

        protected PuzzleBase(string id)
        {
            if (string.IsNullOrWhiteSpace(id))
                throw new ArgumentException("Puzzle id must not be empty", nameof(id));

            Id = id;
        }

        public void Unlock() => SetState(PuzzleState.Available);

        public virtual void Reset()
        {
            OnReset();
            SetState(PuzzleState.Available);
        }

        protected void MarkInProgress() => SetState(PuzzleState.InProgress);

        protected void MarkSolved()
        {
            if (State == PuzzleState.Solved) return;
            SetState(PuzzleState.Solved);
        }

        protected virtual void OnReset() { }

        public abstract string CaptureState();
        public abstract void RestoreState(string payload);

        private void SetState(PuzzleState next)
        {
            if (State == next) return;
            State = next;
            StateChanged?.Invoke(this);
        }
    }
}
```

### Пример конкретной головоломки

Кодовый замок целиком, без единой строки Unity:

```csharp
namespace QuestRoom.Domain.Puzzles
{
    public sealed class CombinationLockPuzzle : PuzzleBase
    {
        private readonly int[] _expected;
        private readonly int[] _current;

        public IReadOnlyList<int> Current => _current;
        public int DialCount => _expected.Length;

        public CombinationLockPuzzle(string id, int[] expected) : base(id)
        {
            if (expected is null || expected.Length == 0)
                throw new ArgumentException("Combination must not be empty", nameof(expected));

            _expected = (int[])expected.Clone();
            _current = new int[expected.Length];
        }

        public void SetDial(int index, int value)
        {
            if (State == PuzzleState.Locked || State == PuzzleState.Solved) return;
            if (index < 0 || index >= _current.Length)
                throw new ArgumentOutOfRangeException(nameof(index));

            _current[index] = ((value % 10) + 10) % 10;
            MarkInProgress();

            if (_current.SequenceEqual(_expected))
                MarkSolved();
        }

        protected override void OnReset() => Array.Clear(_current, 0, _current.Length);

        public override string CaptureState() => string.Join(",", _current);

        public override void RestoreState(string payload)
        {
            if (string.IsNullOrEmpty(payload)) return;

            var parts = payload.Split(',');
            for (var i = 0; i < Math.Min(parts.Length, _current.Length); i++)
                if (int.TryParse(parts[i], out var value))
                    _current[i] = value;
        }
    }
}
```

К этому классу пишется десяток тестов, и ни один из них не требует Unity.

### Инвентарь

```csharp
namespace QuestRoom.Domain
{
    public sealed class Inventory
    {
        private readonly HashSet<string> _items = new();
        private readonly int _capacity;

        public event Action<string> ItemAdded;
        public event Action<string> ItemRemoved;

        public Inventory(int capacity = 4) => _capacity = capacity;

        public IReadOnlyCollection<string> Items => _items;
        public bool Contains(string itemId) => _items.Contains(itemId);

        public bool TryAdd(string itemId)
        {
            if (_items.Count >= _capacity || !_items.Add(itemId)) return false;
            ItemAdded?.Invoke(itemId);
            return true;
        }

        public bool TryRemove(string itemId)
        {
            if (!_items.Remove(itemId)) return false;
            ItemRemoved?.Invoke(itemId);
            return true;
        }
    }
}
```

## Прикладной слой

### Граф зависимостей головоломок

```csharp
namespace QuestRoom.Application
{
    public sealed class ProgressionService
    {
        private readonly Dictionary<string, IPuzzle> _puzzles;
        private readonly Dictionary<string, string[]> _dependencies;

        public event Action<IPuzzle> PuzzleSolved;
        public event Action AllSolved;

        public ProgressionService(
            IEnumerable<IPuzzle> puzzles,
            IReadOnlyDictionary<string, string[]> dependencies)
        {
            _puzzles = puzzles.ToDictionary(p => p.Id);
            _dependencies = dependencies.ToDictionary(kv => kv.Key, kv => kv.Value);

            foreach (var puzzle in _puzzles.Values)
                puzzle.StateChanged += OnPuzzleStateChanged;
        }

        public void Start()
        {
            foreach (var puzzle in _puzzles.Values)
                if (IsUnlocked(puzzle.Id))
                    puzzle.Unlock();
        }

        private bool IsUnlocked(string puzzleId)
        {
            if (!_dependencies.TryGetValue(puzzleId, out var required)) return true;
            return required.All(id =>
                _puzzles.TryGetValue(id, out var dep) && dep.State == PuzzleState.Solved);
        }

        private void OnPuzzleStateChanged(IPuzzle puzzle)
        {
            if (puzzle.State != PuzzleState.Solved) return;

            PuzzleSolved?.Invoke(puzzle);

            foreach (var candidate in _puzzles.Values)
                if (candidate.State == PuzzleState.Locked && IsUnlocked(candidate.Id))
                    candidate.Unlock();

            if (_puzzles.Values.All(p => p.State == PuzzleState.Solved))
                AllSolved?.Invoke();
        }
    }
}
```

Цепочка из концепта задаётся конфигом, а не кодом:

```csharp
var dependencies = new Dictionary<string, string[]>
{
    ["drawer"]   = Array.Empty<string>(),
    ["safe"]     = new[] { "drawer" },
    ["breaker"]  = new[] { "safe" },
    ["radio"]    = new[] { "breaker" },
    ["terminal"] = new[] { "radio", "safe" }
};
```

Поменять порядок или сделать две ветки параллельными — правка одного словаря.

### Конечный автомат комнаты

```csharp
namespace QuestRoom.Application
{
    public enum RoomPhase { Boot, Briefing, Playing, Paused, Escaped, TimeUp }

    public sealed class RoomController
    {
        private readonly ProgressionService _progression;
        private readonly ITimeProvider _time;
        private readonly float _limitSeconds;

        private float _startedAt;

        public RoomPhase Phase { get; private set; } = RoomPhase.Boot;
        public event Action<RoomPhase> PhaseChanged;

        public float Remaining => Phase == RoomPhase.Playing
            ? Math.Max(0f, _limitSeconds - (_time.Now - _startedAt))
            : 0f;

        public RoomController(ProgressionService progression, ITimeProvider time, float limitSeconds)
        {
            _progression = progression;
            _time = time;
            _limitSeconds = limitSeconds;
            _progression.AllSolved += () => Transition(RoomPhase.Escaped);
        }

        public void BeginBriefing() => Transition(RoomPhase.Briefing);

        public void BeginPlay()
        {
            _startedAt = _time.Now;
            _progression.Start();
            Transition(RoomPhase.Playing);
        }

        public void Pause()  { if (Phase == RoomPhase.Playing) Transition(RoomPhase.Paused); }
        public void Resume() { if (Phase == RoomPhase.Paused)  Transition(RoomPhase.Playing); }

        public void Tick()
        {
            if (Phase == RoomPhase.Playing && Remaining <= 0f)
                Transition(RoomPhase.TimeUp);
        }

        private void Transition(RoomPhase next)
        {
            if (Phase == next) return;
            Phase = next;
            PhaseChanged?.Invoke(next);
        }
    }
}
```

`ITimeProvider` — крошечный интерфейс с одним свойством `Now`. В игре его реализует обёртка
над `Time.time`, в тестах — подставной класс с ручным управлением временем. Без этого таймер
не протестировать, и это ровно тот приём, ради которого стоит затевать всю архитектуру.

### Система подсказок

Три уровня на каждую головоломку: намёк, направление, прямое указание. Следующий уровень
открывается по таймеру бездействия или по запросу игрока. Каждая выданная подсказка
записывается в телеметрию — это и есть материал для выводов в отчёте.

```csharp
public sealed class HintService
{
    private readonly IReadOnlyDictionary<string, string[]> _hints;
    private readonly Dictionary<string, int> _issued = new();

    public event Action<string, string> HintIssued; // puzzleId, text

    public bool TryIssue(string puzzleId)
    {
        if (!_hints.TryGetValue(puzzleId, out var ladder)) return false;

        var next = _issued.GetValueOrDefault(puzzleId);
        if (next >= ladder.Length) return false;

        _issued[puzzleId] = next + 1;
        HintIssued?.Invoke(puzzleId, ladder[next]);
        return true;
    }
}
```

### Телеметрия

```csharp
public readonly record struct SessionEvent(float Timestamp, string Kind, string Target, string Payload);
```

Пишутся: старт и финиш, решение каждой головоломки, каждая неверная попытка, каждая выданная
подсказка, каждый телепорт, каждый взятый предмет. На выходе CSV рядом с сохранением.
По нему на защите показывается, где именно застревают тестировщики, и чем это подтверждается.

## Слой инфраструктуры

Сохранение — JSON через `JsonUtility` или `System.Text.Json`, в `Application.persistentDataPath`.

```csharp
[Serializable]
public sealed class SaveData
{
    public string RoomId;
    public float ElapsedSeconds;
    public string[] InventoryItems;
    public PuzzleSnapshot[] Puzzles;
}

[Serializable]
public sealed class PuzzleSnapshot
{
    public string Id;
    public PuzzleState State;
    public string Payload;   // результат CaptureState()
}
```

Запись через временный файл с последующей заменой, чтобы выключение шлема посреди записи
не оставило битый файл. Версия схемы в поле `SaveData` с первого дня: она понадобится
на третьем спринте, когда состав головоломок поменяется.

## Слой представления

Адаптер выглядит так и не длиннее:

```csharp
public sealed class CombinationLockView : MonoBehaviour
{
    [SerializeField] private DialView[] _dials;
    [SerializeField] private Transform _door;

    private CombinationLockPuzzle _puzzle;

    public void Bind(CombinationLockPuzzle puzzle)
    {
        _puzzle = puzzle;
        _puzzle.StateChanged += OnStateChanged;

        for (var i = 0; i < _dials.Length; i++)
        {
            var index = i;
            _dials[i].ValueChanged += value => _puzzle.SetDial(index, value);
        }
    }

    private void OnDestroy()
    {
        if (_puzzle != null) _puzzle.StateChanged -= OnStateChanged;
    }

    private void OnStateChanged(IPuzzle puzzle)
    {
        if (puzzle.State == PuzzleState.Solved) StartCoroutine(OpenDoor());
    }
}
```

Отписка в `OnDestroy` обязательна. Забытая отписка от события — самая частая утечка
в подобных проектах и первое, что стоит искать на код-ревью.

## Что проверяется юнит-тестами

| Класс | Что проверяем |
|---|---|
| `CombinationLockPuzzle` | верный код решает, неверный нет, переполнение цифры, состояние после `Reset` |
| `ProgressionService` | заблокированная головоломка не открывается раньше времени, цепочка разблокировок, событие завершения |
| `RoomController` | переходы фаз, срабатывание таймера, пауза останавливает отсчёт |
| `Inventory` | вместимость, повторное добавление, события |
| `HintService` | лестница подсказок не выходит за границы, счётчик на головоломку независим |
| `SaveRepository` | round-trip сохранения, чтение файла с другой версией схемы, битый файл не роняет игру |

Целевое покрытие доменного и прикладного слоёв — не ниже 70 процентов по строкам.
Слой представления тестами не покрывается, для него ручной чек-лист.
