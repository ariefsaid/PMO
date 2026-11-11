import React from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';

type MenuItemProps = React.ComponentProps<typeof BaseMenu.Item>;
type MenuLinkItemProps = React.ComponentProps<typeof BaseMenu.LinkItem>;
type MenuRadioItemProps = React.ComponentProps<typeof BaseMenu.RadioItem>;
type MenuCheckboxItemProps = React.ComponentProps<typeof BaseMenu.CheckboxItem>;

function MenuItem({ closeOnClick = true, ...props }: MenuItemProps) {
  return <BaseMenu.Item closeOnClick={closeOnClick} {...props} />;
}

function MenuLinkItem({ closeOnClick = true, ...props }: MenuLinkItemProps) {
  return <BaseMenu.LinkItem closeOnClick={closeOnClick} {...props} />;
}

function MenuRadioItem({ closeOnClick = true, ...props }: MenuRadioItemProps) {
  return <BaseMenu.RadioItem closeOnClick={closeOnClick} {...props} />;
}

function MenuCheckboxItem({ closeOnClick = true, ...props }: MenuCheckboxItemProps) {
  return <BaseMenu.CheckboxItem closeOnClick={closeOnClick} {...props} />;
}

const Menu = Object.assign({}, BaseMenu, {
  Item: MenuItem,
  LinkItem: MenuLinkItem,
  RadioItem: MenuRadioItem,
  CheckboxItem: MenuCheckboxItem,
});

export { Menu };
