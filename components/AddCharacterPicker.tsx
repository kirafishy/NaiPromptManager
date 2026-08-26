import React from 'react';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';

export const CHARACTER_ADD_PRESETS = [
  { id: 'female', label: '女性', prompt: 'girl, ' },
  { id: 'male', label: '男性', prompt: 'boy, ' },
  { id: 'other', label: '其他', prompt: '' },
] as const;

export type AddCharacterPickerProps = {
  open: boolean;
  onClose: () => void;
  onPick: (prompt: string) => void;
};

export const AddCharacterPicker: React.FC<AddCharacterPickerProps> = ({
  open,
  onClose,
  onPick,
}) => (
  <Sheet open={open} onClose={onClose} title="添加角色" className="add-char-sheet">
    <div className="sheet-actions">
      {CHARACTER_ADD_PRESETS.map((preset) => (
        <Button
          key={preset.id}
          variant="secondary"
          block
          onClick={() => {
            onPick(preset.prompt);
            onClose();
          }}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  </Sheet>
);
